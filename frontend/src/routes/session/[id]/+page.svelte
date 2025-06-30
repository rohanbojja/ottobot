<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { getSessionById } from '$lib/api/queries';
	import { Send, Terminal, Loader2 } from '@lucide-svelte';
	
	let { data: pageData } = $props();
	
	// Session state
	let sessionId = $derived($page.params.id);
	let chatInput = $state('');
	let messages = $state<Array<{type: string, content: string, timestamp: string}>>([]);
	let isConnected = $state(false);
	let ws: WebSocket | null = null;
	let vncLoaded = $state(false);
	
	// Query session details
	const sessionQuery = createQuery({
		queryKey: ['session', sessionId],
		queryFn: () => getSessionById(sessionId),
		refetchInterval: isConnected ? false : 5000, // Poll until connected
	});
	
	// WebSocket connection
	function connectWebSocket() {
		if (!$sessionQuery.data?.chat_url) return;
		
		const wsUrl = $sessionQuery.data.chat_url;
		ws = new WebSocket(wsUrl);
		
		ws.onopen = () => {
			isConnected = true;
			addMessage('system', 'Connected to session');
		};
		
		ws.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				handleWebSocketMessage(message);
			} catch (e) {
				console.error('Failed to parse WebSocket message:', e);
			}
		};
		
		ws.onerror = (error) => {
			console.error('WebSocket error:', error);
			addMessage('system', 'Connection error occurred');
		};
		
		ws.onclose = () => {
			isConnected = false;
			addMessage('system', 'Disconnected from session');
			// Attempt to reconnect after 3 seconds
			setTimeout(() => {
				if ($sessionQuery.data?.status === 'ready' || $sessionQuery.data?.status === 'running') {
					connectWebSocket();
				}
			}, 3000);
		};
	}
	
	function handleWebSocketMessage(message: any) {
		switch (message.type) {
			case 'user_prompt':
				addMessage('user', message.content);
				break;
			case 'agent_response':
				addMessage('agent', message.content);
				break;
			case 'agent_thinking':
				addMessage('thinking', message.content);
				break;
			case 'agent_action':
				addMessage('action', message.content);
				break;
			case 'system_update':
				addMessage('system', message.content);
				// Check if VNC is ready
				if (message.metadata?.vnc_ready) {
					vncLoaded = true;
				}
				break;
			case 'error':
				addMessage('error', message.error || 'An error occurred');
				break;
		}
	}
	
	function addMessage(type: string, content: string) {
		messages = [...messages, {
			type,
			content,
			timestamp: new Date().toISOString()
		}];
		// Auto-scroll to bottom
		setTimeout(() => {
			const chatContainer = document.getElementById('chat-messages');
			if (chatContainer) {
				chatContainer.scrollTop = chatContainer.scrollHeight;
			}
		}, 10);
	}
	
	function sendMessage() {
		if (!chatInput.trim() || !ws || ws.readyState !== WebSocket.OPEN) return;
		
		ws.send(JSON.stringify({
			type: 'user_prompt',
			content: chatInput.trim()
		}));
		
		chatInput = '';
	}
	
	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}
	
	onMount(() => {
		// Connect WebSocket when session is ready
		const checkAndConnect = () => {
			if ($sessionQuery.data?.status === 'ready' || $sessionQuery.data?.status === 'running') {
				connectWebSocket();
			}
		};
		
		// Initial check
		checkAndConnect();
		
		// Set up interval to check status
		const interval = setInterval(checkAndConnect, 2000);
		
		return () => clearInterval(interval);
	});
	
	onDestroy(() => {
		if (ws) {
			ws.close();
		}
	});
	
	function getMessageClass(type: string) {
		switch (type) {
			case 'user':
				return 'bg-blue-100 dark:bg-blue-900 ml-auto';
			case 'agent':
				return 'bg-gray-100 dark:bg-gray-800';
			case 'thinking':
				return 'bg-yellow-50 dark:bg-yellow-900 italic';
			case 'action':
				return 'bg-green-50 dark:bg-green-900 font-mono text-sm';
			case 'system':
				return 'bg-gray-50 dark:bg-gray-900 text-center text-sm italic';
			case 'error':
				return 'bg-red-50 dark:bg-red-900 text-red-700 dark:text-red-300';
			default:
				return 'bg-gray-100 dark:bg-gray-800';
		}
	}
</script>

<div class="container mx-auto px-4 py-8">
	{#if $sessionQuery.isLoading}
		<div class="flex items-center justify-center h-[600px]">
			<Loader2 class="h-8 w-8 animate-spin" />
		</div>
	{:else if $sessionQuery.error}
		<Card.Card>
			<Card.CardContent class="pt-6">
				<p class="text-red-600">Error loading session: {$sessionQuery.error.message}</p>
			</Card.CardContent>
		</Card.Card>
	{:else if $sessionQuery.data}
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[800px]">
			<!-- VNC Viewer -->
			<Card.Card class="overflow-hidden">
				<Card.CardHeader>
					<Card.CardTitle class="flex items-center gap-2">
						<Terminal class="h-5 w-5" />
						Development Environment
					</Card.CardTitle>
					<Card.CardDescription>
						Status: <span class="font-medium capitalize">{$sessionQuery.data.status}</span>
					</Card.CardDescription>
				</Card.CardHeader>
				<Card.CardContent class="p-0 h-[calc(100%-5rem)]">
					{#if $sessionQuery.data.status === 'ready' || $sessionQuery.data.status === 'running'}
						{#if $sessionQuery.data.vnc_url}
							<iframe
								src={$sessionQuery.data.vnc_url}
								class="w-full h-full border-0"
								title="VNC Session"
								on:load={() => vncLoaded = true}
							/>
							{#if !vncLoaded}
								<div class="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
									<Loader2 class="h-8 w-8 animate-spin" />
								</div>
							{/if}
						{:else}
							<div class="flex items-center justify-center h-full text-gray-500">
								VNC URL not available
							</div>
						{/if}
					{:else if $sessionQuery.data.status === 'initializing'}
						<div class="flex items-center justify-center h-full">
							<div class="text-center">
								<Loader2 class="h-8 w-8 animate-spin mx-auto mb-4" />
								<p class="text-gray-600 dark:text-gray-400">Initializing environment...</p>
							</div>
						</div>
					{:else}
						<div class="flex items-center justify-center h-full text-gray-500">
							Session status: {$sessionQuery.data.status}
						</div>
					{/if}
				</Card.CardContent>
			</Card.Card>
			
			<!-- Chat Interface -->
			<Card.Card class="flex flex-col">
				<Card.CardHeader>
					<Card.CardTitle>Chat with AI Assistant</Card.CardTitle>
					<Card.CardDescription>
						{#if isConnected}
							<span class="text-green-600">● Connected</span>
						{:else}
							<span class="text-gray-500">● Disconnected</span>
						{/if}
					</Card.CardDescription>
				</Card.CardHeader>
				<Card.CardContent class="flex-1 flex flex-col p-0">
					<!-- Messages -->
					<div id="chat-messages" class="flex-1 overflow-y-auto p-4 space-y-2">
						{#if messages.length === 0}
							<div class="text-center text-gray-500 py-8">
								Start a conversation with the AI assistant
							</div>
						{/if}
						{#each messages as message}
							<div class={`p-3 rounded-lg max-w-[80%] ${getMessageClass(message.type)}`}>
								{#if message.type === 'action'}
									<pre class="whitespace-pre-wrap">{message.content}</pre>
								{:else}
									<p class="whitespace-pre-wrap">{message.content}</p>
								{/if}
								<p class="text-xs opacity-60 mt-1">
									{new Date(message.timestamp).toLocaleTimeString()}
								</p>
							</div>
						{/each}
					</div>
					
					<!-- Input -->
					<div class="border-t p-4">
						<div class="flex gap-2">
							<textarea
								bind:value={chatInput}
								on:keydown={handleKeyPress}
								placeholder="Type your message..."
								class="flex-1 min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
								disabled={!isConnected || $sessionQuery.data.status !== 'ready' && $sessionQuery.data.status !== 'running'}
							/>
							<Button.Button
								onclick={sendMessage}
								disabled={!isConnected || !chatInput.trim() || $sessionQuery.data.status !== 'ready' && $sessionQuery.data.status !== 'running'}
								size="icon"
							>
								<Send class="h-4 w-4" />
							</Button.Button>
						</div>
					</div>
				</Card.CardContent>
			</Card.Card>
		</div>
		
		<!-- Session Info -->
		<div class="mt-6">
			<Card.Card>
				<Card.CardContent class="pt-6">
					<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
						<div>
							<p class="text-muted-foreground">Session ID</p>
							<p class="font-mono">{$sessionQuery.data.session_id}</p>
						</div>
						<div>
							<p class="text-muted-foreground">Created</p>
							<p>{new Date($sessionQuery.data.created_at).toLocaleString()}</p>
						</div>
						<div>
							<p class="text-muted-foreground">Expires</p>
							<p>{new Date($sessionQuery.data.expires_at).toLocaleString()}</p>
						</div>
						<div>
							<p class="text-muted-foreground">Status</p>
							<p class="capitalize">{$sessionQuery.data.status}</p>
						</div>
					</div>
				</Card.CardContent>
			</Card.Card>
		</div>
	{/if}
</div>