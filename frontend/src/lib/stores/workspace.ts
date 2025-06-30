import { writable } from 'svelte/store';
import { browser } from '$app/environment';

type Theme = 'light' | 'dark';

interface WorkspaceState {
	theme: Theme;
}

function createWorkspaceStore() {
	const defaultState: WorkspaceState = {
		theme: 'light'
	};

	// Initialize from localStorage if in browser
	const initialState = browser 
		? { ...defaultState, theme: (localStorage.getItem('theme') as Theme) || 'light' }
		: defaultState;

	const { subscribe, set, update } = writable<WorkspaceState>(initialState);

	return {
		subscribe,
		set,
		update,
		get theme() {
			let value: Theme = 'light';
			subscribe(state => value = state.theme)();
			return value;
		},
		set theme(newTheme: Theme) {
			update(state => {
				const updatedState = { ...state, theme: newTheme };
				if (browser) {
					localStorage.setItem('theme', newTheme);
					// Apply theme to document
					document.documentElement.classList.toggle('dark', newTheme === 'dark');
				}
				return updatedState;
			});
		}
	};
}

export const workspaceStore = createWorkspaceStore();