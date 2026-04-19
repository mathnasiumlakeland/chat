<script lang="ts">
	import { Copy } from '@lucide/svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import ActionIcon from './ActionIcon.svelte';

	interface Props {
		onclick: (event?: MouseEvent) => void;
	}

	let { onclick }: Props = $props();
</script>

<Tooltip.Provider>
	<ActionIcon icon={Copy} tooltip="Copy" {onclick} />
</Tooltip.Provider>
