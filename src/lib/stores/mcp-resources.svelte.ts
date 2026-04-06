import { AttachmentType } from '$lib/enums';
import type {
	MCPResourceAttachment,
	MCPResourceContent,
	MCPResourceInfo,
	MCPServerResources
} from '$lib/types';

function createAttachmentId(): string {
	return `mcp-resource-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class MCPResourceStore {
	serverResources = $state<Map<string, MCPServerResources>>(new Map());
	attachments = $state<MCPResourceAttachment[]>([]);
	isLoading = $state(false);

	getAllResourceInfos(): MCPResourceInfo[] {
		const result: MCPResourceInfo[] = [];

		for (const [serverName, serverResources] of this.serverResources.entries()) {
			for (const resource of serverResources.resources) {
				result.push({
					...resource,
					serverName
				});
			}
		}

		return result;
	}

	isAttached(uri: string): boolean {
		return this.attachments.some((attachment) => attachment.resource.uri === uri);
	}

	addAttachment(resource: MCPResourceInfo, content?: string): MCPResourceAttachment {
		const existing = this.attachments.find((attachment) => attachment.resource.uri === resource.uri);
		if (existing) return existing;

		const nextAttachment: MCPResourceAttachment = {
			id: createAttachmentId(),
			resource: {
				...resource,
				mimeType: resource.mimeType
			},
			content: content
				? [
						{
							uri: resource.uri,
							mimeType: resource.mimeType,
							text: content
						}
					]
				: undefined
		};

		this.attachments = [...this.attachments, nextAttachment];
		return nextAttachment;
	}

	removeAttachment(id: string): void {
		this.attachments = this.attachments.filter((attachment) => attachment.id !== id);
	}

	findResourceByUri(uri: string): MCPResourceInfo | null {
		return this.getAllResourceInfos().find((resource) => resource.uri === uri) ?? null;
	}

	updateAttachmentContent(idOrUri: string, content: unknown): void {
		const textContent =
			typeof content === 'string'
				? [{ uri: idOrUri, mimeType: 'text/plain', text: content }]
				: Array.isArray(content)
					? (content as MCPResourceContent[])
					: [];

		this.attachments = this.attachments.map((attachment) =>
			attachment.id === idOrUri || attachment.resource.uri === idOrUri
				? { ...attachment, content: textContent }
				: attachment
		);
	}
}

export const mcpResourceStore = new MCPResourceStore();

export const mcpResources = () => mcpResourceStore.serverResources;
export const mcpResourcesLoading = () => mcpResourceStore.isLoading;
export const mcpHasResourceAttachments = () => mcpResourceStore.attachments.length > 0;
export const mcpResourceAttachments = () => mcpResourceStore.attachments;
export const mcpTotalResourceCount = () => mcpResourceStore.getAllResourceInfos().length;
