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
		showModelLoadingState ? `${clampedModelLoadingProgress}%` : '0%'
	);

	let modelLoadingStatus = $derived.by(() => {
		if (!showModelLoadingState) {
			return '';
		}

		if (clampedModelLoadingProgress > 0) {
			return `${clampedModelLoadingProgress}%`;
		}

		return '0%';
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
		onFilesAdd={handleFilesAdd}
		{onStop}
		onSubmit={handleSubmit}
		onUploadedFileRemove={handleUploadedFileRemove}
	/>

	{#if showModelLoadingState}
		<div class="mt-3 px-4">
			<div class="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
				<p class="model-loading-text truncate font-medium">
					Loading {modelLoadingLabel ?? 'model'}
				</p>

				<span class="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em]">
					{modelLoadingStatus}
				</span>
			</div>

			<div class="h-1 overflow-hidden rounded-full bg-border/80">
				<div
					class="model-loading-progress-fill h-full rounded-full transition-[width] duration-300 ease-out"
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

<style>
	.model-loading-text {
		color: var(--muted-foreground);
		background: linear-gradient(
			90deg,
			var(--muted-foreground) 0%,
			var(--muted-foreground) 42%,
			var(--foreground) 49%,
			var(--foreground) 51%,
			var(--muted-foreground) 58%,
			var(--muted-foreground) 100%
		);
		background-size: 260% 100%;
		background-position: 88% 0;
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		animation: model-loading-shine 2.7s linear infinite;
	}

	.model-loading-progress-fill {
		background: var(--foreground);
	}

	@keyframes model-loading-shine {
		0% {
			background-position: 88% 0;
		}

		88% {
			background-position: 10% 0;
		}

		100% {
			background-position: 10% 0;
		}
	}
</style>
