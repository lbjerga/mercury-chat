# API Reference

## Provider Interface

All provider adapters implement the `ChatProvider` interface defined in `src/providers/types.ts`:

```typescript
interface ChatProvider {
    readonly id: ProviderId;          // 'copilot' | 'openrouter' | 'ollama' | 'mercury'
    readonly label: string;
    readonly capabilities: ProviderCapabilities;
    readonly pricing: ProviderPricing;

    isAvailable(): boolean;

    streamChat(
        messages: MercuryMessage[],
        onToken: (token: string) => void,
        options?: ChatRequestOptions,
    ): Promise<StreamResult>;

    chat(
        messages: MercuryMessage[],
        options?: ChatRequestOptions,
    ): Promise<{ content: string; usage?: TokenUsage }>;

    applyEdit?(
        originalCode: string,
        updateSnippet: string,
    ): Promise<{ content: string; usage?: TokenUsage }>;

    updateConfig(config: Record<string, unknown>): void;
}
```

## Router API

```typescript
import { ProviderRouter } from './providers';

const router = new ProviderRouter({ routeOrder: ['copilot', 'mercury'] });
router.register(new CopilotProvider());
router.register(new MercuryProvider(client));

// Streaming
const result = await router.streamChat(messages, onToken, { tools, signal });

// Non-streaming
const { content } = await router.chat(messages);

// Status
router.selectProvider();           // first available provider
router.lastUsedProvider;           // ID of last-used provider
router.providerStatus();           // health of all providers
```

## Logger API

```typescript
import { logger } from './utils/logger';

logger.setLevel('debug');          // 'debug' | 'info' | 'warn' | 'error' | 'silent'
logger.info('Router initialised');
logger.error('Stream failed', err);
logger.toolCall('readFile', args, result);
logger.apiRequest('mercury-2', 5, 3);
logger.show();                     // open Output Channel
```

## safeAsync API

```typescript
import { safeAsync, safeRun, safeCommand } from './utils/safeAsync';

// Wrap a function
const safeSend = safeAsync(sendMessage, 'sendMessage');

// One-shot
const result = await safeRun(() => fetchData(), 'fetchData');

// VS Code command handler (shows error notification on failure)
const handler = safeCommand(myHandler, 'myCommand');
```

## i18n API

```typescript
import { t, loadLocale, resetLocale } from './i18n';

t('noProvider');                                    // English default
t('error.streamStalled', { seconds: '30' });        // Interpolation
loadLocale({ 'action.explain': 'Expliquer' });      // Override keys
resetLocale();                                       // Back to English
```

## Tool Definitions

See `src/tools/definitions.ts` for the full list of 10 built-in tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file from the workspace |
| `write_file` | Write/create a file |
| `edit_file` | Edit a specific section of a file |
| `list_files` | List directory contents |
| `search_files` | Regex search across files |
| `run_command` | Execute a shell command |
| `search_symbols` | Find symbols (functions, classes) |
| `get_diagnostics` | Get compiler/lint errors |
| `read_url` | Fetch a web page |
| `rapid_code` | Trigger the autonomous agent pipeline |

## Configuration Settings

All settings are under the `mercuryChat.*` namespace. See `package.json` contributes.configuration for the full schema with defaults, types, and descriptions.
