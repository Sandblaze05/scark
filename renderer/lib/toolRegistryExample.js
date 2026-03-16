// Example: register a simple tool and run it via the tool registry
import { registerTool, runTool, listTools, registerDefaultAdapters } from './toolRegistry.js'

// Simple echo tool
registerTool({ id: 'echo', name: 'Echo', description: 'Returns the provided args' }, async (ctx, args) => {
  return { echoed: args };
});

export async function demo() {
  // register default adapters first
  registerDefaultAdapters()

  console.log('Registered tools:', listTools());
  const res = await runTool('echo', {}, { text: 'hello world' });
  console.log('runTool result:', res);
}

if (typeof process !== 'undefined' && process?.argv && process.argv[1] && process.argv[1].endsWith('toolRegistryExample.js')) {
  demo().catch(console.error)
}
