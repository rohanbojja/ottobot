<script lang="ts">
	import * as Button from '$lib/components/ui/button/index.js';
	import { Code, Moon, Sun } from '@lucide/svelte';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import { workspaceStore } from '$lib/stores/workspace.js';
	import type { Snippet } from 'svelte';
	import '../app.css';

	let { children }: { children: Snippet } = $props();
	let dark = $derived($workspaceStore.theme === 'dark');

	function toggleDark() {
		workspaceStore.theme = dark ? 'light' : 'dark';
	}
	const queryClient = new QueryClient();
</script>


<QueryClientProvider client={queryClient}>
    <div class="min-h-screen bg-background">
	<!-- Navigation Header -->
	<header class="sticky top-0 z-50 w-full border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
		<div class="container flex h-14 max-w-screen-2xl items-center">
			<!-- Logo -->
			<div class="mr-4 flex">
				<a class="mr-4 flex items-center gap-2 lg:mr-6" href="/">
					<Code class="h-6 w-6" />
					<span class="font-bold">OttoBot</span>
				</a>
			</div>

			<!-- Navigation Links -->
			<div class="flex flex-1 items-center justify-between space-x-2 md:justify-end">
				<nav class="flex items-center gap-4 text-sm lg:gap-6">
					<a
						class="transition-colors hover:text-foreground/80 text-foreground/60"
						href="/"
					>
						Dashboard
					</a>
					<a
						class="transition-colors hover:text-foreground/80 text-foreground/60"
						href="/sessions"
					>
						Sessions
					</a>
					<a
						class="transition-colors hover:text-foreground/80 text-foreground/60"
						href="/docs"
					>
						Docs
					</a>
				</nav>

				<!-- Theme Toggle -->
				<Button.Button
					variant="ghost"
					size="sm"
					onclick={toggleDark}
					class="h-8 w-8 px-0"
				>
					<Sun class="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
					<Moon class="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
					<span class="sr-only">Toggle theme</span>
				</Button.Button>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main>
		{@render children()}
	</main>
    </div></QueryClientProvider>
