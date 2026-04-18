<script lang="ts">
	import '../app.css';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		ChatSidebar,
		DialogChatSettings,
		DialogConversationTitleUpdate
	} from '$lib/components/app';
	import { KeyboardKey } from '$lib/enums';
	import { TOOLTIP_DELAY_DURATION } from '$lib/constants';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import { setChatSettingsDialogContext } from '$lib/contexts';
	import { activeMessages, conversationsStore } from '$lib/stores/conversations.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { isLoading } from '$lib/stores/chat.svelte';

	let { children } = $props();

	let isChatRoute = $derived(page.route.id === '/chat/[id]');
	let showSidebarByDefault = $derived(activeMessages().length > 0 || isLoading());
	let alwaysShowSidebarOnDesktop = $derived(config().alwaysShowSidebarOnDesktop);
	let autoShowSidebarOnNewChat = $derived(config().autoShowSidebarOnNewChat);
	let isMobile = new IsMobile();
	let isDesktop = $derived(!isMobile.current);
	let sidebarOpen = $state(false);
	let innerHeight = $state<number | undefined>();
	let chatSidebar:
		| { activateSearchMode?: () => void; editActiveConversation?: () => void }
		| undefined = $state();

	let titleUpdateDialogOpen = $state(false);
	let titleUpdateCurrentTitle = $state('');
	let titleUpdateNewTitle = $state('');
	let titleUpdateResolve: ((value: boolean) => void) | null = null;

	let chatSettingsDialogOpen = $state(false);

	setChatSettingsDialogContext({
		open: () => {
			chatSettingsDialogOpen = true;
		}
	});

	function handleKeydown(event: KeyboardEvent) {
		const isCtrlOrCmd = event.ctrlKey || event.metaKey;

		if (isCtrlOrCmd && event.key === KeyboardKey.K_LOWER) {
			event.preventDefault();
			chatSidebar?.activateSearchMode?.();
			sidebarOpen = true;
		}

		if (isCtrlOrCmd && event.shiftKey && event.key === KeyboardKey.O_UPPER) {
			event.preventDefault();
			goto(resolve('/'));
		}

		if (isCtrlOrCmd && event.shiftKey && event.key === KeyboardKey.E_UPPER) {
			event.preventDefault();
			chatSidebar?.editActiveConversation?.();
		}
	}

	function handleTitleUpdateCancel() {
		titleUpdateDialogOpen = false;
		titleUpdateResolve?.(false);
		titleUpdateResolve = null;
	}

	function handleTitleUpdateConfirm() {
		titleUpdateDialogOpen = false;
		titleUpdateResolve?.(true);
		titleUpdateResolve = null;
	}

	$effect(() => {
		if (alwaysShowSidebarOnDesktop && isDesktop) {
			sidebarOpen = true;
			return;
		}

		if (isChatRoute && autoShowSidebarOnNewChat) {
			sidebarOpen = true;
			return;
		}

		sidebarOpen = showSidebarByDefault;
	});

	$effect(() => {
		conversationsStore.setTitleUpdateConfirmationCallback(
			async (currentTitle: string, newTitle: string) => {
				return new Promise<boolean>((resolve) => {
					titleUpdateCurrentTitle = currentTitle;
					titleUpdateNewTitle = newTitle;
					titleUpdateResolve = resolve;
					titleUpdateDialogOpen = true;
				});
			}
		);
	});

	$effect(() => {
		untrack(() => {
			void conversationsStore.initialize();
		});
	});
</script>

<svelte:head>
	<title>Local Chat</title>
</svelte:head>

<Tooltip.Provider delayDuration={TOOLTIP_DELAY_DURATION}>
	<ModeWatcher />
	<Toaster richColors />

	<DialogChatSettings
		open={chatSettingsDialogOpen}
		onOpenChange={(open) => (chatSettingsDialogOpen = open)}
	/>

	<DialogConversationTitleUpdate
		bind:open={titleUpdateDialogOpen}
		currentTitle={titleUpdateCurrentTitle}
		newTitle={titleUpdateNewTitle}
		onConfirm={handleTitleUpdateConfirm}
		onCancel={handleTitleUpdateCancel}
	/>

	<Sidebar.Provider bind:open={sidebarOpen}>
		<div class="flex h-screen w-full" style:height="{innerHeight}px">
			<Sidebar.Root class="h-full">
				<ChatSidebar bind:this={chatSidebar} />
			</Sidebar.Root>

			{#if !(alwaysShowSidebarOnDesktop && isDesktop)}
				<Sidebar.Trigger
					class="transition-left absolute left-0 z-[900] duration-200 ease-linear {sidebarOpen
						? 'md:left-[var(--sidebar-width)]'
						: 'md:left-0!'}"
					style="translate: 1rem 1rem;"
				/>
			{/if}

			<Sidebar.Inset class="flex flex-1 flex-col overflow-hidden">
				{@render children?.()}
			</Sidebar.Inset>
		</div>
	</Sidebar.Provider>
</Tooltip.Provider>

<svelte:window onkeydown={handleKeydown} bind:innerHeight />
