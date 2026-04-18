import { browser } from '$app/environment';
import { DEFAULT_MCP_CONFIG } from '$lib/constants/mcp';
import {
	ColorMode,
	HealthCheckStatus,
	MCPConnectionPhase,
	MCPLogLevel,
	MCPRefType,
	MCPTransportType
} from '$lib/enums';
import { mcpResourceStore } from '$lib/stores/mcp-resources.svelte';
import { config, settingsStore } from '$lib/stores/settings.svelte';
import type {
	GetPromptResult,
	HealthCheckState,
	MCPCapabilitiesInfo,
	MCPConnectionLog,
	MCPPromptInfo,
	MCPResourceAttachment,
	MCPResourceContent,
	MCPResourceIcon,
	MCPResourceInfo,
	MCPServerInfo,
	MCPServerResources,
	MCPServerSettingsEntry,
	MCPToolInfo,
	OpenAIToolDefinition,
	ToolExecutionResult
} from '$lib/types';
import type { McpServerOverride } from '$lib/types/chat';
import {
	detectMcpTransportFromUrl,
	getFaviconUrl,
	getProxiedUrlString,
	parseMcpServerSettings
} from '$lib/utils';
import { Client } from '@modelcontextprotocol/sdk/client';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type HealthState = HealthCheckState;

type ConnectedTool = {
	name: string;
	description?: string;
	title?: string;
	inputSchema?: Record<string, unknown>;
	serverId: string;
};

type ActiveConnection = {
	capabilities?: MCPCapabilitiesInfo;
	client: Client;
	connectionTimeMs: number;
	instructions?: string;
	prompts: MCPPromptInfo[];
	protocolVersion?: string;
	resources: MCPServerResources;
	serverInfo?: MCPServerInfo;
	tools: ConnectedTool[];
	transportType: MCPTransportType;
};

type ResolvedToolBinding = ConnectedTool & {
	alias: string;
};

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function parseHeaders(headers?: string): Record<string, string> {
	if (!headers?.trim()) {
		return {};
	}

	try {
		const parsed = JSON.parse(headers);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {};
		}

		return Object.fromEntries(
			Object.entries(parsed).map(([key, value]) => [key, String(value)])
		);
	} catch {
		return {};
	}
}

function toServerInfo(
	serverId: string,
	versionInfo: { name?: string; version?: string; title?: string } | undefined
): MCPServerInfo | undefined {
	if (!versionInfo) {
		return undefined;
	}

	return {
		name: versionInfo.name ?? serverId,
		version: versionInfo.version ?? '',
		title: versionInfo.title
	};
}

function toCapabilitiesInfo(serverCapabilities: unknown): MCPCapabilitiesInfo | undefined {
	if (!serverCapabilities || typeof serverCapabilities !== 'object') {
		return undefined;
	}

	const server = serverCapabilities as Record<string, unknown>;

	return {
		server: {
			tools:
				server.tools && typeof server.tools === 'object'
					? (server.tools as { listChanged?: boolean })
					: undefined,
			prompts:
				server.prompts && typeof server.prompts === 'object'
					? (server.prompts as { listChanged?: boolean })
					: undefined,
			resources:
				server.resources && typeof server.resources === 'object'
					? (server.resources as { subscribe?: boolean; listChanged?: boolean })
					: undefined,
			logging: Boolean(server.logging),
			completions: Boolean(server.completions),
			tasks: Boolean(server.tasks)
		},
		client: {}
	};
}

function normalizeColorMode(theme: unknown): ColorMode.LIGHT | ColorMode.DARK | undefined {
	if (theme === ColorMode.LIGHT || theme === ColorMode.DARK) {
		return theme;
	}

	return undefined;
}

function mapResourceIcons(icons: unknown): MCPResourceIcon[] | undefined {
	if (!Array.isArray(icons)) {
		return undefined;
	}

	return icons.flatMap((icon) => {
		if (!icon || typeof icon !== 'object') {
			return [];
		}

		const candidate = icon as {
			src?: unknown;
			mimeType?: unknown;
			sizes?: unknown;
			theme?: unknown;
		};

		if (typeof candidate.src !== 'string') {
			return [];
		}

		return [
			{
				src: candidate.src,
				mimeType:
					typeof candidate.mimeType === 'string' ? (candidate.mimeType as never) : undefined,
				sizes: Array.isArray(candidate.sizes)
					? candidate.sizes.filter((size): size is string => typeof size === 'string')
					: undefined,
				theme: normalizeColorMode(candidate.theme)
			}
		];
	});
}

function createEmptyServerResources(serverName: string): MCPServerResources {
	return {
		serverName,
		resources: [],
		templates: [],
		loading: false
	};
}

function slugifyToolNamespace(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function formatStructuredContent(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function formatToolContentBlock(block: unknown): string {
	if (!block || typeof block !== 'object') {
		return String(block);
	}

	const contentBlock = block as Record<string, unknown>;

	switch (contentBlock.type) {
		case 'text':
			return typeof contentBlock.text === 'string' ? contentBlock.text : '';
		case 'image':
			return '[Image result omitted in text mode]';
		case 'audio':
			return '[Audio result omitted in text mode]';
		case 'resource_link':
			return typeof contentBlock.uri === 'string'
				? `[Resource link] ${contentBlock.uri}`
				: '[Resource link]';
		case 'resource': {
			const resource = contentBlock.resource;
			if (!resource || typeof resource !== 'object') {
				return '[Embedded resource]';
			}

			const embedded = resource as Record<string, unknown>;
			if (typeof embedded.text === 'string') {
				return embedded.text;
			}
			if (typeof embedded.blob === 'string') {
				return '[Embedded binary resource omitted in text mode]';
			}

			return '[Embedded resource]';
		}
		default:
			return formatStructuredContent(contentBlock);
	}
}

function formatToolExecutionResult(result: unknown): ToolExecutionResult {
	if (result && typeof result === 'object' && 'toolResult' in result) {
		return {
			content: formatStructuredContent((result as { toolResult: unknown }).toolResult),
			isError: false
		};
	}

	const normalizedResult =
		result && typeof result === 'object'
			? (result as {
					content?: unknown[];
					structuredContent?: Record<string, unknown>;
					isError?: boolean;
				})
			: {};
	const content = Array.isArray(normalizedResult.content)
		? normalizedResult.content
				.map((block) => formatToolContentBlock(block))
				.filter((block) => block.trim().length > 0)
				.join('\n\n')
		: '';
	const structuredContent =
		normalizedResult.structuredContent &&
		Object.keys(normalizedResult.structuredContent).length > 0
			? formatStructuredContent(normalizedResult.structuredContent)
			: '';
	const combinedContent = [content.trim(), structuredContent.trim()]
		.filter(Boolean)
		.join('\n\n');

	return {
		content:
			combinedContent || (normalizedResult.isError ? 'Tool execution failed.' : 'Tool completed.'),
		isError: Boolean(normalizedResult.isError)
	};
}

class MCPStore {
	private servers = $state<MCPServerSettingsEntry[]>([]);
	private healthStates = $state<Record<string, HealthState>>({});
	private initialized = $state(false);
	private serverFavicons = $state<Record<string, string | null>>({});
	isProxyAvailable = $state(false);

	#connections = new Map<string, ActiveConnection>();

	constructor() {
		if (browser) {
			settingsStore.initialize();
			this.#loadFromSettings();
		}
	}

	#loadFromSettings(): void {
		if (!browser || this.initialized) {
			return;
		}

		const parsedServers = parseMcpServerSettings(config().mcpServers);
		this.servers = parsedServers;
		this.serverFavicons = Object.fromEntries(
			parsedServers.map((server) => [server.id, getFaviconUrl(server.url, false)])
		);
		this.initialized = true;
	}

	#persistServers(): void {
		if (!browser) {
			return;
		}

		settingsStore.updateConfig(
			'mcpServers',
			JSON.stringify(
				this.servers.map(({ id, enabled, url, headers, name, useProxy }) => ({
					id,
					enabled,
					url,
					headers,
					name,
					useProxy
				}))
			)
		);
	}

	#getServer(server: string | MCPServerSettingsEntry): MCPServerSettingsEntry | undefined {
		const serverId = typeof server === 'string' ? server : server.id;
		return this.servers.find((entry) => entry.id === serverId);
	}

	#getEnabledServers(overrides?: McpServerOverride[]): MCPServerSettingsEntry[] {
		if (!overrides || overrides.length === 0) {
			return this.servers.filter((server) => server.enabled);
		}

		const overridesById = new Map(
			overrides.map((override) => [override.serverId, override.enabled])
		);

		return this.servers.filter((server) => {
			const overrideEnabled = overridesById.get(server.id);
			return server.enabled && (overrideEnabled ?? true);
		});
	}

	#getResolvedToolBindings(overrides?: McpServerOverride[]): ResolvedToolBinding[] {
		const enabledServers = this.#getEnabledServers(overrides);
		const connectedTools = enabledServers.flatMap((server) =>
			(this.#connections.get(server.id)?.tools ?? []).map((tool) => ({
				...tool,
				serverId: server.id
			}))
		);
		const toolNameCounts = new Map<string, number>();

		for (const tool of connectedTools) {
			toolNameCounts.set(tool.name, (toolNameCounts.get(tool.name) ?? 0) + 1);
		}

		return connectedTools.map((tool) => {
			if ((toolNameCounts.get(tool.name) ?? 0) === 1) {
				return {
					...tool,
					alias: tool.name
				};
			}

			const serverLabel = this.getServerDisplayName(tool.serverId) || tool.serverId;
			const namespace = slugifyToolNamespace(serverLabel) || slugifyToolNamespace(tool.serverId);

			return {
				...tool,
				alias: `${namespace}__${tool.name}`
			};
		});
	}

	#setHealthState(serverId: string, state: HealthState): void {
		this.healthStates = {
			...this.healthStates,
			[serverId]: state
		};
	}

	#pushLog(
		logs: MCPConnectionLog[],
		phase: MCPConnectionPhase,
		message: string,
		level: MCPLogLevel = MCPLogLevel.INFO,
		details?: unknown
	): MCPConnectionLog[] {
		return [
			...logs,
			{
				timestamp: new Date(),
				phase,
				message,
				details,
				level
			}
		];
	}

	#getTransportCandidates(server: MCPServerSettingsEntry): MCPTransportType[] {
		const detectedTransport = detectMcpTransportFromUrl(server.url);

		if (detectedTransport === MCPTransportType.WEBSOCKET) {
			return [MCPTransportType.WEBSOCKET];
		}

		return [MCPTransportType.STREAMABLE_HTTP, MCPTransportType.SSE];
	}

	#createTransport(server: MCPServerSettingsEntry, transportType: MCPTransportType) {
		if (transportType === MCPTransportType.WEBSOCKET) {
			throw new Error('WebSocket MCP servers are not supported in this browser runtime.');
		}

		if (server.useProxy) {
			throw new Error('The llama-server MCP proxy is not available in this browser runtime.');
		}

		const requestHeaders = parseHeaders(server.headers);
		const requestInit =
			Object.keys(requestHeaders).length > 0 ? ({ headers: requestHeaders } satisfies RequestInit) : undefined;
		const targetUrl = server.useProxy
			? getProxiedUrlString(server.url)
			: server.url;
		const url = new URL(targetUrl);

		if (transportType === MCPTransportType.STREAMABLE_HTTP) {
			return new StreamableHTTPClientTransport(url, { requestInit });
		}

		return new SSEClientTransport(url, { requestInit });
	}

	async #disconnectServer(serverId: string): Promise<void> {
		const connection = this.#connections.get(serverId);
		if (!connection) {
			return;
		}

		this.#connections.delete(serverId);
		await connection.client.close().catch(() => {});
	}

	async #listTools(client: Client, serverId: string, logs: MCPConnectionLog[]) {
		const nextLogs = this.#pushLog(
			logs,
			MCPConnectionPhase.LISTING_TOOLS,
			'Listing server tools...'
		);
		this.#setHealthState(serverId, {
			status: HealthCheckStatus.CONNECTING,
			phase: MCPConnectionPhase.LISTING_TOOLS,
			logs: nextLogs
		});

		const result = await client.listTools(undefined, {
			timeout: DEFAULT_MCP_CONFIG.connectionTimeoutMs
		});

		return {
			logs: this.#pushLog(
				nextLogs,
				MCPConnectionPhase.LISTING_TOOLS,
				`Loaded ${result.tools.length} tool${result.tools.length === 1 ? '' : 's'}.`
			),
			tools: result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				title: tool.title,
				inputSchema: tool.inputSchema,
				serverId
			}))
		};
	}

	async #listPrompts(client: Client, serverId: string, logs: MCPConnectionLog[]) {
		const result = await client.listPrompts(undefined, {
			timeout: DEFAULT_MCP_CONFIG.connectionTimeoutMs
		});

		return {
			logs: this.#pushLog(
				logs,
				MCPConnectionPhase.CONNECTED,
				`Loaded ${result.prompts.length} prompt${result.prompts.length === 1 ? '' : 's'}.`
			),
			prompts: result.prompts.map((prompt) => ({
				name: prompt.name,
				description: prompt.description,
				title: prompt.title,
				serverName: serverId,
				arguments: prompt.arguments
			}))
		};
	}

	async #listResources(client: Client, serverId: string, logs: MCPConnectionLog[]) {
		const resourcesResult = await client.listResources(undefined, {
			timeout: DEFAULT_MCP_CONFIG.connectionTimeoutMs
		});
		const templatesResult = await client.listResourceTemplates(undefined, {
			timeout: DEFAULT_MCP_CONFIG.connectionTimeoutMs
		});

		return {
			logs: this.#pushLog(
				logs,
				MCPConnectionPhase.CONNECTED,
				`Loaded ${resourcesResult.resources.length} resource${resourcesResult.resources.length === 1 ? '' : 's'} and ${templatesResult.resourceTemplates.length} template${templatesResult.resourceTemplates.length === 1 ? '' : 's'}.`
			),
			resources: {
				serverName: serverId,
				resources: resourcesResult.resources.map((resource) => ({
					...resource,
					icons: mapResourceIcons(resource.icons)
				})),
				templates: templatesResult.resourceTemplates.map((template) => ({
					...template,
					icons: mapResourceIcons(template.icons)
				})),
				loading: false,
				lastFetched: new Date()
			} satisfies MCPServerResources
		};
	}

	async #connectWithTransport(
		server: MCPServerSettingsEntry,
		transportType: MCPTransportType,
		initialLogs: MCPConnectionLog[]
	): Promise<{ connection: ActiveConnection; logs: MCPConnectionLog[] }> {
		let logs = this.#pushLog(
			initialLogs,
			MCPConnectionPhase.TRANSPORT_CREATING,
			`Connecting via ${transportType === MCPTransportType.STREAMABLE_HTTP ? 'HTTP' : 'SSE'}...`
		);
		this.#setHealthState(server.id, {
			status: HealthCheckStatus.CONNECTING,
			phase: MCPConnectionPhase.TRANSPORT_CREATING,
			logs
		});

		const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
		const client = new Client(DEFAULT_MCP_CONFIG.clientInfo, {
			capabilities: DEFAULT_MCP_CONFIG.capabilities
		});
		const transport = this.#createTransport(server, transportType);

		await client.connect(transport, {
			timeout: DEFAULT_MCP_CONFIG.connectionTimeoutMs
		});

		logs = this.#pushLog(logs, MCPConnectionPhase.INITIALIZING, 'Initializing MCP session...');
		this.#setHealthState(server.id, {
			status: HealthCheckStatus.CONNECTING,
			phase: MCPConnectionPhase.INITIALIZING,
			logs
		});

		const serverCapabilities = client.getServerCapabilities();
		const serverVersion = client.getServerVersion();
		const protocolVersion =
			'protocolVersion' in transport && typeof transport.protocolVersion === 'string'
				? transport.protocolVersion
				: DEFAULT_MCP_CONFIG.protocolVersion;
		const capabilities = toCapabilitiesInfo(serverCapabilities);

		logs = this.#pushLog(
			logs,
			MCPConnectionPhase.CAPABILITIES_EXCHANGED,
			'Capabilities exchanged successfully.'
		);
		this.#setHealthState(server.id, {
			status: HealthCheckStatus.CONNECTING,
			phase: MCPConnectionPhase.CAPABILITIES_EXCHANGED,
			logs
		});

		let tools: ConnectedTool[] = [];
		let prompts: MCPPromptInfo[] = [];
		let resources = createEmptyServerResources(server.id);

		if (capabilities?.server.tools) {
			const result = await this.#listTools(client, server.id, logs);
			logs = result.logs;
			tools = result.tools;
		}

		if (capabilities?.server.prompts) {
			const result = await this.#listPrompts(client, server.id, logs);
			logs = result.logs;
			prompts = result.prompts;
		}

		if (capabilities?.server.resources) {
			const result = await this.#listResources(client, server.id, logs);
			logs = result.logs;
			resources = result.resources;
		}

		logs = this.#pushLog(logs, MCPConnectionPhase.CONNECTED, 'Server connected.');

		return {
			logs,
			connection: {
				client,
				transportType,
				tools,
				prompts,
				resources,
				capabilities,
				serverInfo: toServerInfo(server.id, serverVersion),
				protocolVersion,
				instructions: client.getInstructions(),
				connectionTimeMs:
					(typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
			}
		};
	}

	getServers(): MCPServerSettingsEntry[] {
		this.#loadFromSettings();
		return this.servers;
	}

	getServersSorted(): MCPServerSettingsEntry[] {
		return [...this.getServers()].sort((left, right) =>
			this.getServerLabel(left).localeCompare(this.getServerLabel(right))
		);
	}

	getServerLabel(server: { id: string; name?: string; url?: string }): string {
		const successState = this.healthStates[server.id];
		const serverInfo =
			successState?.status === HealthCheckStatus.SUCCESS ? successState.serverInfo : undefined;

		return (
			server.name?.trim() ||
			serverInfo?.title?.trim() ||
			serverInfo?.name?.trim() ||
			server.url?.trim() ||
			server.id
		);
	}

	getServerDisplayName(serverId: string): string {
		const server = this.servers.find((entry) => entry.id === serverId);
		return this.getServerLabel(server ?? { id: serverId });
	}

	getServerFavicon(serverId: string): string | null {
		return this.serverFavicons[serverId] ?? null;
	}

	getHealthCheckState(serverId: string): HealthState {
		return (
			this.healthStates[serverId] ?? {
				status: HealthCheckStatus.IDLE
			}
		);
	}

	hasEnabledServers(overrides?: McpServerOverride[]): boolean {
		return this.#getEnabledServers(overrides).length > 0;
	}

	hasPromptsCapability(overrides?: McpServerOverride[]): boolean {
		return this.#getEnabledServers(overrides).some((server) => {
			const state = this.getHealthCheckState(server.id);
			return state.status === HealthCheckStatus.SUCCESS && Boolean(state.capabilities?.server.prompts);
		});
	}

	hasResourcesCapability(overrides?: McpServerOverride[]): boolean {
		return this.#getEnabledServers(overrides).some((server) => {
			const state = this.getHealthCheckState(server.id);
			return state.status === HealthCheckStatus.SUCCESS && Boolean(state.capabilities?.server.resources);
		});
	}

	async ensureInitialized(overrides?: McpServerOverride[]): Promise<boolean> {
		this.#loadFromSettings();

		const targetServers = this.#getEnabledServers(overrides);
		if (targetServers.length === 0) {
			return false;
		}

		const uncheckedServers = targetServers.filter((server) => {
			const state = this.getHealthCheckState(server.id);
			return state.status !== HealthCheckStatus.SUCCESS;
		});

		if (uncheckedServers.length > 0) {
			await this.runHealthChecksForServers(uncheckedServers);
		}

		return targetServers.some(
			(server) => this.getHealthCheckState(server.id).status === HealthCheckStatus.SUCCESS
		);
	}

	async runHealthChecksForServers(
		servers: MCPServerSettingsEntry[],
		parallel = true
	): Promise<void> {
		const uniqueServers = Array.from(new Map(servers.map((server) => [server.id, server])).values());

		if (parallel) {
			await Promise.allSettled(uniqueServers.map((server) => this.runHealthCheck(server)));
			return;
		}

		for (const server of uniqueServers) {
			await this.runHealthCheck(server);
		}
	}

	async runHealthCheck(server: string | MCPServerSettingsEntry): Promise<void> {
		this.#loadFromSettings();

		const existingServer = this.#getServer(server);
		if (!existingServer) {
			return;
		}

		await this.#disconnectServer(existingServer.id);

		if (!existingServer.url.trim()) {
			this.#setHealthState(existingServer.id, {
				status: HealthCheckStatus.ERROR,
				message: 'Server URL is required.',
				phase: MCPConnectionPhase.ERROR,
				logs: []
			});
			return;
		}

		let logs: MCPConnectionLog[] = [];
		let lastError: unknown = null;

		for (const transportType of this.#getTransportCandidates(existingServer)) {
			try {
				const result = await this.#connectWithTransport(existingServer, transportType, logs);
				logs = result.logs;
				this.#connections.set(existingServer.id, result.connection);
				this.serverFavicons = {
					...this.serverFavicons,
					[existingServer.id]: getFaviconUrl(existingServer.url, false)
				};
				this.#setHealthState(existingServer.id, {
					status: HealthCheckStatus.SUCCESS,
					tools: result.connection.tools.map(({ name, description, title }) => ({
						name,
						description,
						title
					})),
					serverInfo: result.connection.serverInfo,
					capabilities: result.connection.capabilities,
					transportType: result.connection.transportType,
					protocolVersion: result.connection.protocolVersion,
					instructions: result.connection.instructions,
					connectionTimeMs: result.connection.connectionTimeMs,
					logs
				});
				return;
			} catch (error) {
				lastError = error;
				logs = this.#pushLog(
					logs,
					MCPConnectionPhase.ERROR,
					normalizeErrorMessage(error),
					MCPLogLevel.ERROR,
					error
				);
			}
		}

		this.#setHealthState(existingServer.id, {
			status: HealthCheckStatus.ERROR,
			message: normalizeErrorMessage(lastError ?? 'Failed to connect to the MCP server.'),
			phase: MCPConnectionPhase.ERROR,
			logs
		});
	}

	getAllPrompts(overrides?: McpServerOverride[]): MCPPromptInfo[] {
		return this.#getEnabledServers(overrides).flatMap(
			(server) => this.#connections.get(server.id)?.prompts ?? []
		);
	}

	getOpenAIToolDefinitions(overrides?: McpServerOverride[]): OpenAIToolDefinition[] {
		return this.#getResolvedToolBindings(overrides).map((tool) => ({
			type: 'function',
			function: {
				name: tool.alias,
				description: tool.description,
				parameters: tool.inputSchema ?? {
					type: 'object',
					properties: {}
				}
			}
		}));
	}

	getAgenticInstructions(overrides?: McpServerOverride[]): string[] {
		return this.#getEnabledServers(overrides)
			.map((server) => this.#connections.get(server.id)?.instructions?.trim())
			.filter((instruction): instruction is string => Boolean(instruction));
	}

	async getPrompt(
		serverName: string,
		promptName: string,
		argumentsRecord?: Record<string, string>
	): Promise<GetPromptResult | null> {
		const connection = this.#connections.get(serverName);
		if (!connection) {
			return null;
		}

		const result = await connection.client.getPrompt(
			{
				name: promptName,
				arguments: argumentsRecord
			},
			{ timeout: DEFAULT_MCP_CONFIG.requestTimeoutSeconds * 1000 }
		);

		return result as GetPromptResult;
	}

	async getPromptCompletions(
		serverName: string,
		promptName: string,
		argumentName: string,
		value: string
	): Promise<{ values: string[] }> {
		const connection = this.#connections.get(serverName);
		if (!connection) {
			return { values: [] };
		}

		const result = await connection.client.complete(
			{
				ref: {
					type: MCPRefType.PROMPT,
					name: promptName
				},
				argument: {
					name: argumentName,
					value
				}
			},
			{ timeout: DEFAULT_MCP_CONFIG.requestTimeoutSeconds * 1000 }
		);

		return { values: result.completion.values ?? [] };
	}

	async fetchAllResources(overrides?: McpServerOverride[]): Promise<void> {
		const targetServers = this.#getEnabledServers(overrides).filter(
			(server) => this.#connections.has(server.id)
		);

		mcpResourceStore.isLoading = true;

		try {
			const nextResources = new Map<string, MCPServerResources>();

			for (const server of targetServers) {
				const connection = this.#connections.get(server.id);
				if (!connection) {
					continue;
				}

				if (connection.capabilities?.server.resources) {
					const result = await this.#listResources(connection.client, server.id, []);
					connection.resources = result.resources;
				}

				nextResources.set(server.id, connection.resources);
			}

			mcpResourceStore.serverResources = nextResources;
		} finally {
			mcpResourceStore.isLoading = false;
		}
	}

	async readResourceByUri(...args: unknown[]): Promise<MCPResourceContent[] | null> {
		const uri = String(args.at(-1) ?? '');
		const serverName = args.length > 1 ? String(args[0] ?? '') : '';
		const connection =
			(serverName ? this.#connections.get(serverName) : null) ??
			(this.#connections.get(mcpResourceStore.findResourceByUri(uri)?.serverName ?? '') ?? null);
		if (!connection) {
			return null;
		}

		const result = await connection.client.readResource(
			{ uri },
			{ timeout: DEFAULT_MCP_CONFIG.requestTimeoutSeconds * 1000 }
		);

		return result.contents as MCPResourceContent[];
	}

	async readResource(...args: unknown[]): Promise<MCPResourceContent[] | null> {
		return this.readResourceByUri(...args);
	}

	async getResourceCompletions(
		serverName: string,
		uriTemplate: string,
		argumentName: string,
		value: string
	): Promise<{ values: string[] }> {
		const connection = this.#connections.get(serverName);
		if (!connection) {
			return { values: [] };
		}

		const result = await connection.client.complete(
			{
				ref: {
					type: MCPRefType.RESOURCE,
					uri: uriTemplate
				},
				argument: {
					name: argumentName,
					value
				}
			},
			{ timeout: DEFAULT_MCP_CONFIG.requestTimeoutSeconds * 1000 }
		);

		return { values: result.completion.values ?? [] };
	}

	async callTool(
		toolName: string,
		argumentsRecord: Record<string, unknown>,
		overrides?: McpServerOverride[]
	): Promise<ToolExecutionResult> {
		const resolvedTool = this.#getResolvedToolBindings(overrides).find(
			(tool) => tool.alias === toolName
		);
		if (!resolvedTool) {
			return {
				content: `Tool "${toolName}" is not available.`,
				isError: true
			};
		}

		const connection = this.#connections.get(resolvedTool.serverId);
		if (!connection) {
			return {
				content: `The MCP server for tool "${toolName}" is not connected.`,
				isError: true
			};
		}

		try {
			const result = await connection.client.callTool(
				{
					name: resolvedTool.name,
					arguments: argumentsRecord
				},
				undefined,
				{ timeout: DEFAULT_MCP_CONFIG.requestTimeoutSeconds * 1000 }
			);

			return formatToolExecutionResult(result);
		} catch (error) {
			return {
				content: normalizeErrorMessage(error),
				isError: true
			};
		}
	}

	attachResource(resource: MCPResourceInfo | string, content?: string): MCPResourceAttachment {
		if (typeof resource === 'string') {
			const known = mcpResourceStore.findResourceByUri(resource);
			return mcpResourceStore.addAttachment(
				known ?? {
					uri: resource,
					name: resource.split('/').at(-1) ?? resource,
					serverName: 'local'
				},
				content
			);
		}

		return mcpResourceStore.addAttachment(resource, content);
	}

	removeResourceAttachment(attachmentId: string): void {
		mcpResourceStore.removeAttachment(attachmentId);
	}

	addServer(
		server: Partial<MCPServerSettingsEntry> & { id: string; url: string; enabled: boolean }
	): void {
		this.#loadFromSettings();

		this.servers = [
			...this.servers,
			{
				requestTimeoutSeconds: DEFAULT_MCP_CONFIG.requestTimeoutSeconds,
				...server
			} as MCPServerSettingsEntry
		];
		this.serverFavicons = {
			...this.serverFavicons,
			[server.id]: getFaviconUrl(server.url, false)
		};
		this.#persistServers();
	}

	updateServer(serverId: string, updates: Partial<MCPServerSettingsEntry>): void {
		this.servers = this.servers.map((server) =>
			server.id === serverId ? { ...server, ...updates } : server
		);
		this.serverFavicons = {
			...this.serverFavicons,
			[serverId]: getFaviconUrl(
				this.servers.find((server) => server.id === serverId)?.url ?? '',
				false
			)
		};
		void this.#disconnectServer(serverId);
		this.#setHealthState(serverId, { status: HealthCheckStatus.IDLE });
		this.#persistServers();
	}

	removeServer(serverId: string): void {
		void this.#disconnectServer(serverId);
		this.servers = this.servers.filter((server) => server.id !== serverId);
		this.#connections.delete(serverId);
		const nextHealthStates = { ...this.healthStates };
		delete nextHealthStates[serverId];
		this.healthStates = nextHealthStates;
		const nextFavicons = { ...this.serverFavicons };
		delete nextFavicons[serverId];
		this.serverFavicons = nextFavicons;
		const nextResources = new Map(mcpResourceStore.serverResources);
		nextResources.delete(serverId);
		mcpResourceStore.serverResources = nextResources;
		this.#persistServers();
	}
}

export const mcpStore = new MCPStore();
