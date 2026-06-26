
export const LEGAL_MODEL = 'anthropic/claude-haiku-4.5';

export function assertGatewayConfigured() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "Missing AI_GATEWAY_API_KEY in .env file. All model calls must go through Vercel AI Gateway."
    );
  }
}