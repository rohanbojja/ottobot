<script lang="ts">
	import { page } from '$app/state';
	import { getSessionById } from '$lib/api/queries';
	import { Button } from '$lib/components/ui/button';
	import * as Card from "$lib/components/ui/card/index.js";
	import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
	import { ExternalLink, Loader2, Send, Terminal, Download } from '@lucide/svelte/icons';
	import { createQuery } from '@tanstack/svelte-query';
	import { onDestroy, onMount } from 'svelte';

	// Removed unused pageData props

	// Session state
	let sessionId = $derived(page.params.id);

	let chatInput = $state('');
	let messages = $state<Array<{id: string, type: string, content: string, timestamp: string}>>([]);
	let messageIds = new Set<string>();
	let isConnected = $state(false);
	let isConnecting = $state(false);
	let ws: WebSocket | null = null;
	let vncLoaded = $state(false);
	let reconnectTimeout: number | null = null;
	let messagesContainer: HTMLElement;

	// Query session details
	const sessionQuery = createQuery({
		queryKey: ['session', sessionId],
		queryFn: () => {
			console.log('Fetching session data for ID:', sessionId);
			return getSessionById(sessionId);
		},
		refetchInterval: isConnected ? 30000 : 10000, // Poll every 30s when connected, 10s when not
		retry: 3,
		retryDelay: 1000,
	});

	// WebSocket connection
	function connectWebSocket() {
		if (!$sessionQuery.data?.chat_url) return;
		if (isConnecting || isConnected) return; // Prevent multiple connections

		// Clear any pending reconnection timeout
		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout);
			reconnectTimeout = null;
		}

		// Close existing connection if any
		if (ws && ws.readyState !== WebSocket.CLOSED) {
			console.log('Closing existing WebSocket connection');
			ws.close();
		}

		isConnecting = true;
		const wsUrl = $sessionQuery.data.chat_url;
		console.log('Connecting to WebSocket:', wsUrl);
		ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			isConnecting = false;
			isConnected = true;
			console.log('WebSocket connected successfully');

			// Clear old messages when reconnecting to prevent duplicates
			if (messages.length > 0) {
				console.log('Clearing old messages on reconnect');
				messages = [];
				messageIds.clear();
			}
		};

		ws.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				console.log('Received WebSocket message:', message);
				handleWebSocketMessage(message);
			} catch (e) {
				console.error('Failed to parse WebSocket message:', e, 'Raw data:', event.data);
			}
		};

		ws.onerror = (error) => {
			console.error('WebSocket error:', error);
			isConnecting = false;
			isConnected = false;
			addMessage('system', 'Connection error occurred');
		};

		ws.onclose = (event) => {
			isConnecting = false;
			isConnected = false;
			console.log('WebSocket closed:', event.code, event.reason);

			// Only show disconnect message if it wasn't a normal closure
			if (event.code !== 1000) {
				addMessage('system', 'Disconnected from session');

				// Only attempt to reconnect if session is still active and it was an unexpected disconnect
				if ($sessionQuery.data?.status === 'ready' || $sessionQuery.data?.status === 'running') {
					console.log('Attempting to reconnect in 5 seconds...');
					reconnectTimeout = setTimeout(() => {
						connectWebSocket();
					}, 5000); // Increased to 5 seconds
				}
			}
		};
	}

	function handleWebSocketMessage(message: any) {
		// Create unique message ID based on timestamp and content
		const messageId = `${message.type}-${message.timestamp}-${message.content?.substring(0, 10)}`;

		switch (message.type) {
			case 'user_prompt':
				addMessage('user', message.content, messageId);
				break;
			case 'agent_response':
				addMessage('agent', message.content, messageId);
				break;
			case 'agent_thinking':
				addMessage('thinking', message.content, messageId);
				break;
			case 'agent_action':
				addMessage('action', message.content, messageId);
				break;
			case 'system_update':
				addMessage('system', message.content, messageId);
				// Check if VNC is ready
				if (message.metadata?.vnc_ready) {
					vncLoaded = true;
				}
				break;
			case 'error':
				addMessage('error', message.error || 'An error occurred', messageId);
				break;
			default:
				console.warn('Unknown message type:', message.type, message);
		}
	}

	function addMessage(type: string, content: string, messageId?: string) {
		// Generate ID if not provided (for deduplication)
		const id = messageId || `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		// Prevent duplicate messages
		if (messageIds.has(id)) {
			console.log('Skipping duplicate message:', id);
			return;
		}

		messageIds.add(id);
		messages = [...messages, {
			id,
			type,
			content,
			timestamp: new Date().toISOString()
		}];

		// Always auto-scroll to bottom on new messages
		setTimeout(() => {
			scrollToBottom();
		}, 150);
	}

	function sendMessage() {
		if (!chatInput.trim() || !ws || ws.readyState !== WebSocket.OPEN) {
			console.log('Cannot send message:', {
				hasInput: !!chatInput.trim(),
				hasWs: !!ws,
				wsState: ws?.readyState
			});
			return;
		}

		const message = {
			type: 'user_prompt',
			content: chatInput.trim(),
			timestamp: Date.now(),
		};

		console.log('Sending message:', message);
		ws.send(JSON.stringify(message));

		chatInput = '';
		
		// Scroll to bottom after sending message
		setTimeout(() => {
			scrollToBottom();
		}, 50);
	}

	// Scroll functions
	function scrollToBottom() {
		if (messagesContainer) {
			messagesContainer.scrollIntoView({ 
				behavior: 'smooth', 
				block: 'end' 
			});
		}
	}

	// VNC fullscreen function
	function openVncFullscreen() {
		if ($sessionQuery.data?.vnc_url) {
			const vncWindow = window.open(
				$sessionQuery.data.vnc_url,
				'vnc-fullscreen',
				'width=1920,height=1080,scrollbars=yes,resizable=yes,status=no,location=no,toolbar=no,menubar=no'
			);

			if (vncWindow) {
				vncWindow.focus();
			} else {
				alert('Please allow popups to open VNC in fullscreen mode');
			}
		}
	}

	// Download session function
	function downloadSession() {
		if ($sessionQuery.data?.session_id) {
			const downloadUrl = `/api/download/${$sessionQuery.data.session_id}`;
			
			// Create a temporary link to trigger download
			const link = document.createElement('a');
			link.href = downloadUrl;
			link.download = `ottobot-session-${$sessionQuery.data.session_id}.zip`;
			link.style.display = 'none';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		}
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
			// Only try to connect if not already connected or connecting
			if (!isConnected && !isConnecting && ($sessionQuery.data?.status === 'ready' || $sessionQuery.data?.status === 'running')) {
				connectWebSocket();
			}
		};

		// Initial check
		checkAndConnect();

		// Set up interval to check status (less frequent)
		const interval = setInterval(checkAndConnect, 10000); // Reduced frequency to 10 seconds

		return () => {
			clearInterval(interval);
			if (reconnectTimeout) {
				clearTimeout(reconnectTimeout);
			}
		};
	});

	onDestroy(() => {
		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout);
		}
		if (ws) {
			console.log('Cleaning up WebSocket connection');
			ws.close(1000, 'Component destroyed'); // Normal closure
			ws = null;
		}
		isConnected = false;
		isConnecting = false;
	});

	function getMessageClass(type: string) {
		switch (type) {
			case 'user':
				return 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 ml-auto';
			case 'agent':
				return 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';
			case 'thinking':
				return 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-700';
			case 'action':
				return 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700';
			case 'system':
				return 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600 mx-auto text-center';
			case 'error':
				return 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300';
			default:
				return 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700';
		}
	}
</script>

<svelte:head>
	<title>Session {sessionId} - OttoBot</title>
</svelte:head>

<div class="container mx-auto px-4 py-4">
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
		<!-- Debug: Session data loaded successfully -->
		<div class="max-w-3xl mx-auto">
			<!-- Chat Interface -->
			<Card.Card class="flex flex-col h-[calc(100vh-10rem)]">
				<Card.CardHeader>
					<div class="flex items-center justify-between">
						<div>
							<Card.CardTitle>Chat with AI Assistant</Card.CardTitle>
							<Card.CardDescription>
								{#if $sessionQuery.data.status === 'initializing'}
									<span class="text-yellow-600">● Initializing...</span>
								{:else if isConnected}
									<span class="text-green-600">● Connected</span>
								{:else}
									<span class="text-gray-500">● Disconnected</span>
								{/if}
							</Card.CardDescription>
						</div>
						<!-- Action buttons -->
						<div class="flex gap-2">
							{#if $sessionQuery.data.vnc_url && ($sessionQuery.data.status === 'ready' || $sessionQuery.data.status === 'running')}
								<Button
									variant="outline"
									size="sm"
									onclick={openVncFullscreen}
									title="Open development environment in new window"
								>
									<ExternalLink class="h-4 w-4 mr-2" />
									Open VNC
								</Button>
								<Button
									variant="outline"
									size="sm"
									onclick={downloadSession}
									title="Download session workspace as zip"
								>
									<Download class="h-4 w-4 mr-2" />
									Download
								</Button>
							{/if}
						</div>
					</div>
				</Card.CardHeader>
				<Card.CardContent class="flex-1 flex flex-col p-0 max-h-[calc(100%-6rem)]">
					<!-- Messages -->
					<div class="flex max-h-[calc(100%-5rem)] w-full relative">
						{#if $sessionQuery.data.status === 'initializing'}
							<div class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-10">
								<div class="text-center">
									<Loader2 class="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
									<p class="text-gray-600 dark:text-gray-400 font-medium">Initializing environment...</p>
									<p class="text-sm text-gray-500 dark:text-gray-500 mt-2">This may take a moment</p>
								</div>
							</div>
						{/if}
						<ScrollArea 
							class="p-2 m-2 w-full scroll-smooth"
						>
							<!-- Always show initial prompt if available -->
							{#if $sessionQuery.data.initial_prompt}
								<div class="group relative p-3 mb-2 rounded-lg max-w-[85%] shadow-sm border bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700 ml-auto">
									<div class="text-xs font-medium text-blue-600 mb-1">Initial Prompt</div>
									<p class="whitespace-pre-wrap text-sm leading-relaxed">{$sessionQuery.data.initial_prompt}</p>
									<div class="flex justify-between items-center mt-2 text-xs opacity-60">
										<span class="group-hover:opacity-100 transition-opacity">
											{new Date($sessionQuery.data.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
										</span>
										<span class="text-blue-500">→</span>
									</div>
								</div>
							{/if}

							{#if messages.length === 0}
								<div class="text-center text-gray-500 py-8">
									{#if $sessionQuery.data.status === 'initializing'}
										Environment is being prepared...
									{:else}
										{$sessionQuery.data.initial_prompt ? 'Agent will respond shortly...' : 'Start a conversation with the AI assistant'}
									{/if}
								</div>
							{/if}
								{#each messages as message}
									<div class={`group relative p-3 mb-2 rounded-lg max-w-[85%] shadow-sm border animate-in slide-in-from-bottom-2 fade-in-0 duration-300 ${getMessageClass(message.type)}`}>
										<!-- Message type indicator -->
										{#if message.type === 'user'}
											<div class="text-xs font-medium text-blue-600 mb-1">You</div>
										{:else if message.type === 'agent'}
											<div class="text-xs font-medium text-gray-600 mb-1">AI Assistant</div>
										{:else if message.type === 'thinking'}
											<div class="text-xs font-medium text-yellow-600 mb-1">🤔 Thinking...</div>
										{:else if message.type === 'action'}
											<div class="text-xs font-medium text-green-600 mb-1">⚡ Action</div>
										{:else if message.type === 'system'}
											<div class="text-xs font-medium text-gray-500 mb-1">🔧 System</div>
										{:else if message.type === 'error'}
											<div class="text-xs font-medium text-red-600 mb-1">❌ Error</div>
										{/if}

										<!-- Message content -->
										{#if message.type === 'action'}
											<pre class="whitespace-pre-wrap text-sm font-mono bg-gray-50 dark:bg-gray-800 p-2 rounded border">{message.content}</pre>
										{:else}
											<p class="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
										{/if}

										<!-- Timestamp -->
										<div class="flex justify-between items-center mt-2 text-xs opacity-60">
											<span class="group-hover:opacity-100 transition-opacity">
												{new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
											</span>
											{#if message.type === 'user'}
												<span class="text-blue-500">→</span>
											{:else if message.type === 'agent'}
												<span class="text-gray-500">←</span>
											{/if}
										</div>
									</div>
								{/each}
								<div bind:this={messagesContainer}></div>
						</ScrollArea>

					</div>

					<!-- Input -->
					<div class="border-t p-4 place-items-center">
						<div class="flex gap-2 place-items-center">
							<textarea
								bind:value={chatInput}
								onkeydown={handleKeyPress}
								placeholder="Type your message..."
								class="flex-1 min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
								disabled={!isConnected || $sessionQuery.data.status !== 'ready' && $sessionQuery.data.status !== 'running'}
							/>
							<Button
								onclick={sendMessage}
								disabled={!isConnected || !chatInput.trim() || $sessionQuery.data.status !== 'ready' && $sessionQuery.data.status !== 'running'}
								size="icon"
							>
								<Send class="h-4 w-4" />
							</Button>
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
	{:else}
		<!-- Debug: No session data available -->
		<Card.Card>
			<Card.CardContent class="pt-6">
				<p class="text-yellow-600">Session data not available</p>
				<details class="mt-4">
					<summary class="cursor-pointer text-sm text-gray-500">Debug Info</summary>
					<pre class="mt-2 text-xs bg-gray-100 p-2 rounded">{JSON.stringify({
						sessionId,
						isLoading: $sessionQuery.isLoading,
						isError: $sessionQuery.isError,
						error: $sessionQuery.error?.message,
						data: $sessionQuery.data
					}, null, 2)}</pre>
				</details>
			</Card.CardContent>
		</Card.Card>
	{/if}
</div>
