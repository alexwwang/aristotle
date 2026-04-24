import type { ApiMode } from './types.js';

export async function detectApiMode(client: any): Promise<ApiMode | null> {
  const testSession = await client.session.create({
    body: { title: 'aristotle-bridge-api-probe' },
  });
  try {
    await client.session.promptAsync({
      path: { id: testSession.data.id },
      body: { parts: [{ type: 'text', text: 'probe' }] },
    });
    return 'promptAsync';
  } catch {
    return null;
  } finally {
    await client.session.delete({ path: { id: testSession.data.id } }).catch(() => {});
  }
}
