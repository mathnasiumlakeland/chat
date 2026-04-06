import { HealthCheckStatus } from '$lib/enums';
import { mcpResourceStore } from '$lib/stores/mcp-resources.svelte';
import type {
	GetPromptResult,
	HealthCheckState,
	MCPPromptInfo,
	MCPResourceAttachment,
	MCPResourceContent,
	MCPResourceInfo,
	MCPServerSettingsEntry
} from '$lib/types';
import type { McpServerOverride } from '$lib/types/chat';

type HealthState = HealthCheckState;

class MCPStore {
	private servers = $state<MCPServerSettingsEntry[]>([]);
	private healthStates = $state<Record<string, HealthState>>({});
	private initialized = $state(true);
	isProxyAvailable = $state(false);

	getServers(): MCPServerSettingsEntry[] {
		return this.servers;
	}

	getServersSorted(): MCPServerSettingsEntry[] {
		return [...this.servers];
	}

	getServerLabel(server: { id: string; name?: string; url?: string }): string {
		return server.name?.trim() || server.url?.trim() || server.id;
	}

	getServerDisplayName(serverId: string): string {
		return this.servers.find((server) => server.id === serverId)?.name || serverId;
	}

	getServerFavicon(_serverId: string): string | null {
		return null;
	}

	getHealthCheckState(serverId: string): HealthState {
		return (
			this.healthStates[serverId] ?? {
				status: HealthCheckStatus.IDLE,
				logs: []
			}
		);
	}

	hasEnabledServers(_overrides?: McpServerOverride[]): boolean {
		return false;
	}

	hasPromptsCapability(_overrides?: McpServerOverride[]): boolean {
		return false;
	}

	hasResourcesCapability(_overrides?: McpServerOverride[]): boolean {
		return false;
	}

	async ensureInitialized(_overrides?: McpServerOverride[]): Promise<boolean> {
		return this.initialized;
	}

	async runHealthChecksForServers(
		_servers: MCPServerSettingsEntry[],
		_parallel = true
	): Promise<void> {}

	async runHealthCheck(_server: string | MCPServerSettingsEntry): Promise<void> {}

	getAllPrompts(): MCPPromptInfo[] {
		return [];
	}

	async getPrompt(
		_serverName: string,
		_promptName: string,
		_arguments?: Record<string, string>
	): Promise<GetPromptResult | null> {
		return null;
	}

	async getPromptCompletions(..._args: unknown[]): Promise<{ values: string[] }> {
		return { values: [] };
	}

	async fetchAllResources(): Promise<void> {}

	async readResourceByUri(...args: unknown[]): Promise<MCPResourceContent[] | null> {
		const uri = String(args.at(-1) ?? '');
		const resource = mcpResourceStore.findResourceByUri(uri);
		if (!resource) return null;

		return [
			{
				uri: resource.uri,
				mimeType: resource.mimeType,
				text: ''
			}
		] as MCPResourceContent[];
	}

	async readResource(...args: unknown[]): Promise<MCPResourceContent[] | null> {
		const uri = String(args.at(-1) ?? '');
		return this.readResourceByUri(uri);
	}

	async getResourceCompletions(..._args: unknown[]): Promise<{ values: string[] }> {
		return { values: [] };
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
		this.servers = [
			...this.servers,
			{
				requestTimeoutSeconds: 30,
				...server
			} as MCPServerSettingsEntry
		];
	}

	updateServer(serverId: string, updates: Partial<MCPServerSettingsEntry>): void {
		this.servers = this.servers.map((server) =>
			server.id === serverId ? { ...server, ...updates } : server
		);
	}

	removeServer(serverId: string): void {
		this.servers = this.servers.filter((server) => server.id !== serverId);
	}
}

export const mcpStore = new MCPStore();
