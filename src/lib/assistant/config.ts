/** Explicit model selection; provider errors never trigger a silent model downgrade. */
export function businessAssistantConfig() {
  const effort = process.env.OPENAI_ASSISTANT_REASONING_EFFORT || 'medium';
  return {
    enabled: !!process.env.OPENAI_API_KEY?.trim(),
    model: process.env.OPENAI_ASSISTANT_MODEL?.trim() || 'gpt-6.1-sol',
    effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort) ? effort : 'medium',
  };
}
