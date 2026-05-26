export function taskRow(task) {
  const spec = task.spec ?? {};
  const result = task.result ?? null;
  return stripUndefined({
    task_id: task.task_id,
    status: task.status,
    created_at: task.created_at,
    updated_at: task.updated_at,
    winner_agent_id: task.winner_agent_id,
    auction_price_usd: task.auction_price_usd,
    winning_bid_usd: task.winning_bid_usd,
    prompt: spec.prompt,
    min_tier: spec.min_tier,
    output: result?.output,
    actual_input_tokens: result?.actual_usage?.input_tokens,
    actual_output_tokens: result?.actual_usage?.output_tokens,
    spec_json: spec,
    result_json: result,
  });
}

export function bidRow(bid) {
  const response = bid.response ?? {};
  return stripUndefined({
    task_id: bid.task_id,
    agent_id: bid.agent_id,
    timestamp: bid.timestamp,
    response_kind: bid.response_kind,
    tier: response.tier,
    model_family: response.model_family,
    model_id: response.model_id,
    bid_usd: response.bid_usd,
    est_input_tokens: response.est_input_tokens,
    est_output_tokens: response.est_output_tokens,
    no_bid_reason: bid.no_bid_reason,
    response_json: response,
    pricing_snapshot_json: bid.pricing_snapshot ?? [],
  });
}

export function resultRow(result) {
  return stripUndefined({
    task_id: result.task_id,
    agent_id: result.agent_id,
    timestamp: result.timestamp,
    actual_input_tokens: result.actual_input_tokens,
    actual_output_tokens: result.actual_output_tokens,
    actual_step_count: result.actual_step_count,
    actual_tool_call_count: result.actual_tool_call_count,
    result_json: result.result,
    step_trace_json: result.step_trace,
  });
}

export function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
