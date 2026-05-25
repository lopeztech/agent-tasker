import { describe, expect, it } from "vitest";
import { INITIAL_TOOL_SURFACE, buildToolSurfacePreamble } from "../src/tools.js";

describe("INITIAL_TOOL_SURFACE", () => {
  it("keeps the Phase 1 orchestrator surface narrow and auditable", () => {
    expect(INITIAL_TOOL_SURFACE.map((tool) => tool.id)).toEqual([
      "readonly_http_fetch",
      "search_retrieval",
      "code_eval_sandbox",
    ]);
    expect(INITIAL_TOOL_SURFACE).toHaveLength(3);
    expect(INITIAL_TOOL_SURFACE[0]?.guardrails).toContain("Only GET and HEAD are allowed.");
    expect(INITIAL_TOOL_SURFACE[2]?.guardrails).toContain("No network access from evaluated code.");
  });
});

describe("buildToolSurfacePreamble", () => {
  it("renders tool ids, contracts, and guardrails for the GAEP request", () => {
    const preamble = buildToolSurfacePreamble();

    expect(preamble).toContain("readonly_http_fetch");
    expect(preamble).toContain("search_retrieval");
    expect(preamble).toContain("code_eval_sandbox");
    expect(preamble).toContain("Do not send credentials");
    expect(preamble).toContain("Prefer the fewest tool calls");
  });
});
