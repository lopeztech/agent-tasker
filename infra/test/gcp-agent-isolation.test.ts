import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("../..", import.meta.url).pathname;

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function terraformModule(paths: string[]): string {
  return paths.map(read).join("\n");
}

const geminiInfra = terraformModule([
  "infra/agent-gcp-gemini/main.tf",
  "infra/agent-gcp-gemini/cloud_run.tf",
  "infra/agent-gcp-gemini/variables.tf",
]);

const orchestratorInfra = terraformModule([
  "infra/agent-gcp-orchestrator/main.tf",
  "infra/agent-gcp-orchestrator/cloud_run.tf",
  "infra/agent-gcp-orchestrator/variables.tf",
]);

describe("GCP agent Terraform isolation", () => {
  it("uses distinct runtime service accounts", () => {
    expect(geminiInfra).toContain('account_id   = "${local.name_prefix}-gcp-gemini"');
    expect(orchestratorInfra).toContain("account_id   = local.agent_service_account_id");
    expect(orchestratorInfra).toContain(
      'agent_service_account_id = "${substr(var.project, 0, 12)}-${substr(var.env, 0, 8)}-orch"',
    );
  });

  it("grants Cloud Run invocation only to the coordinator service account", () => {
    for (const moduleText of [geminiInfra, orchestratorInfra]) {
      expect(moduleText).toContain(
        'member   = "serviceAccount:${var.coordinator_service_account_email}"',
      );
      expect(moduleText).not.toContain(
        'member   = "serviceAccount:${google_service_account.agent_runtime.email}"',
      );
    }
  });

  it("keeps GAEP execution roles out of the direct Gemini stack", () => {
    expect(geminiInfra).toContain('role    = "roles/aiplatform.user"');
    expect(geminiInfra).not.toContain("gaep_agent_execution_roles");
    expect(geminiInfra).not.toContain("roles/discoveryengine");

    expect(orchestratorInfra).toContain("gaep_agent_execution_roles");
    expect(orchestratorInfra).toContain("roles/discoveryengine.agentspaceUser");
  });

  it("does not create shared secrets or logging sinks inside either agent stack", () => {
    for (const moduleText of [geminiInfra, orchestratorInfra]) {
      expect(moduleText).not.toContain("google_secret_manager_secret");
      expect(moduleText).not.toContain("google_logging_project_sink");
      expect(moduleText).not.toContain("google_logging_folder_sink");
    }
  });
});

describe("GCP agent runtime separation", () => {
  it("keeps direct Gemini execution on Vertex and orchestrator execution on GAEP", () => {
    const geminiRunner = read("agent/gcp-gemini/src/execute/runner.ts");
    const orchestratorRuntime = read("agent/gcp-orchestrator/src/runtime.ts");

    expect(geminiRunner).toContain("@google-cloud/vertexai");
    expect(geminiRunner).toContain("getGenerativeModel");
    expect(geminiRunner).not.toContain("discoveryengine.googleapis.com");

    expect(orchestratorRuntime).toContain("discoveryengine.googleapis.com/v1");
    expect(orchestratorRuntime).toContain(":answer");
    expect(orchestratorRuntime).not.toContain("@google-cloud/vertexai");
    expect(orchestratorRuntime).not.toContain("getGenerativeModel");
  });

  it("keeps deployment package identities separate", () => {
    const geminiPackage = read("agent/gcp-gemini/package.json");
    const orchestratorPackage = read("agent/gcp-orchestrator/package.json");

    expect(geminiPackage).toContain('"name": "@agent-tasker/agent-gcp-gemini"');
    expect(orchestratorPackage).toContain('"name": "@agent-tasker/agent-gcp-orchestrator"');
  });
});
