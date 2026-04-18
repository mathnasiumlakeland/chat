<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { ChatFormHelperText, ChatForm } from '$lib/components/app';
	import { onMount } from 'svelte';

	interface Props {
		class?: string;
		disabled?: boolean;
		initialMessage?: string;
		isLoading?: boolean;
		modelLoadingLabel?: string | null;
		modelLoadingProgress?: number;
		showModelLoadingState?: boolean;
		onFileRemove?: (fileId: string) => void;
		onFileUpload?: (files: File[]) => void;
		onSend?: (message: string, files?: ChatUploadedFile[]) => Promise<boolean>;
		onStop?: () => void;
		onSystemPromptAdd?: (draft: { message: string; files: ChatUploadedFile[] }) => void;
		showHelperText?: boolean;
		uploadedFiles?: ChatUploadedFile[];
	}

	let {
		class: className,
		disabled = false,
		initialMessage = '',
		isLoading = false,
		modelLoadingLabel = null,
		modelLoadingProgress = 0,
		showModelLoadingState = false,
		onFileRemove,
		onFileUpload,
		onSend,
		onStop,
		onSystemPromptAdd,
		showHelperText = true,
		uploadedFiles = $bindable([])
	}: Props = $props();

	let chatFormRef: ChatForm | undefined = $state(undefined);
	let message = $state('');
	let previousIsLoading = $state(false);
	let previousInitialMessage = $state('');

	// Sync message when initialMessage prop changes (e.g., after draft restoration)
	$effect(() => {
		if (initialMessage !== previousInitialMessage) {
			message = initialMessage;
			previousInitialMessage = initialMessage;
		}
	});

	function handleSystemPromptClick() {
		onSystemPromptAdd?.({ message, files: uploadedFiles });
	}

	let hasLoadingAttachments = $derived(uploadedFiles.some((f) => f.isLoading));

	async function handleSubmit() {
		if (
			(!message.trim() && uploadedFiles.length === 0) ||
			disabled ||
			isLoading ||
			hasLoadingAttachments
		)
			return;

		if (!chatFormRef?.checkModelSelected()) return;

		const messageToSend = message.trim();
		const filesToSend = [...uploadedFiles];

		let success = false;
		try {
			success = (await onSend?.(messageToSend, filesToSend)) ?? false;
		} catch (error) {
			console.error('Failed to send message:', error);
		}

		if (success) {
			message = '';
			uploadedFiles = [];
			chatFormRef?.resetTextareaHeight();
		}
	}

	function handleFilesAdd(files: File[]) {
		onFileUpload?.(files);
	}

	function handleUploadedFileRemove(fileId: string) {
		onFileRemove?.(fileId);
	}

	onMount(() => {
		setTimeout(() => chatFormRef?.focus(), 10);
	});

	afterNavigate(() => {
		setTimeout(() => chatFormRef?.focus(), 10);
	});

	$effect(() => {
		if (previousIsLoading && !isLoading) {
			setTimeout(() => chatFormRef?.focus(), 10);
		}

		previousIsLoading = isLoading;
	});

	let clampedModelLoadingProgress = $derived.by(() => {
		const progress = Number(modelLoadingProgress);
		if (!Number.isFinite(progress)) {
			return 0;
		}

		return Math.max(0, Math.min(progress, 100));
	});

	let modelLoadingProgressWidth = $derived(
		showModelLoadingState
			? `${clampedModelLoadingProgress > 0 ? clampedModelLoadingProgress : 8}%`
			: '0%'
	);

	let modelLoadingStatus = $derived.by(() => {
		if (!showModelLoadingState) {
			return '';
		}

		if (clampedModelLoadingProgress > 0) {
			return `${clampedModelLoadingProgress}%`;
		}

		return 'Starting...';
	});
</script>

<div class="relative mx-auto max-w-[48rem]">
	<ChatForm
		bind:this={chatFormRef}
		bind:value={message}
		bind:uploadedFiles
		class={className}
		{disabled}
		{isLoading}
		showPendingState={showModelLoadingState}
		showMcpPromptButton
		onFilesAdd={handleFilesAdd}
		{onStop}
		onSubmit={handleSubmit}
		onSystemPromptClick={handleSystemPromptClick}
		onUploadedFileRemove={handleUploadedFileRemove}
	/>

	{#if showModelLoadingState}
		<div class="mt-3 px-4">
			<div class="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
				<p class="truncate font-medium text-foreground/80">
					Loading {modelLoadingLabel ?? 'model'}...
				</p>

				<span class="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em]">
					{modelLoadingStatus}
				</span>
			</div>

			<div class="h-1 overflow-hidden rounded-full bg-border/80">
				<div
					class="h-full rounded-full bg-foreground/70 transition-[width] duration-300 ease-out"
					class:animate-pulse={clampedModelLoadingProgress === 0}
					style:width={modelLoadingProgressWidth}
				></div>
			</div>

			<p class="mt-2 text-xs text-muted-foreground">
				Your message will send automatically when the model is ready.
			</p>
		</div>
	{/if}
</div>

<ChatFormHelperText show={showHelperText && !showModelLoadingState} />
