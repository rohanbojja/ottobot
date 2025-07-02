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
	<div class="min-h-screen bg-gradient-to-br from-background to-muted/20 flex flex-col">
		<!-- Navigation Header -->
		<header class="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
			<div class="container flex h-16 max-w-screen-2xl items-center px-4 mx-auto">
				<!-- Logo -->
				<div class="mr-8 flex">
					<a class="flex items-center gap-3 hover:opacity-80 transition-opacity" href="/">
						<div class="flex items-center justify-center w-8 h-8 bg-primary text-primary-foreground rounded-lg">
							<Code class="h-5 w-5" />
						</div>
						<span class="font-bold text-xl tracking-tight">OttoBot</span>
					</a>
				</div>

				<!-- Navigation Links -->
				<div class="flex flex-1 items-center justify-between space-x-2 md:justify-end">
					<nav class="flex items-center gap-1 text-sm lg:gap-2">
						<a
							class="px-3 py-2 rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground hover:text-foreground"
							href="/"
						>
							Dashboard
						</a>
						<a
							class="px-3 py-2 rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground hover:text-foreground"
							href="/sessions"
						>
							Sessions
						</a>
						<a
							class="px-3 py-2 rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground hover:text-foreground"
							href="/docs"
						>
							Documentation
						</a>
					</nav>

					<!-- Theme Toggle -->
					<Button.Button
						variant="ghost"
						size="sm"
						onclick={toggleDark}
						class="h-9 w-9 px-0 ml-4 hover:bg-accent"
						aria-label="Toggle theme"
					>
						<Sun class="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
						<Moon class="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
						<span class="sr-only">Toggle theme</span>
					</Button.Button>
				</div>
			</div>
		</header>

		<!-- Main Content -->
		<main class="container mx-auto px-4 py-8 max-w-screen-2xl flex-1">
			{@render children()}
		</main>

		<!-- Footer -->
		<footer class="border-t bg-muted/50">
			<div class="container mx-auto px-4 py-6 max-w-screen-2xl">
				<div class="flex flex-col items-center justify-between gap-4 md:flex-row">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<Code class="h-4 w-4" />
						<span>OttoBot - Interactive AI Coding Agent</span>
					</div>
					<div class="text-sm text-muted-foreground">
						Built with SvelteKit, Elysia & LangGraph
					</div>
				</div>
			</div>
		</footer>
	</div>
</QueryClientProvider>
