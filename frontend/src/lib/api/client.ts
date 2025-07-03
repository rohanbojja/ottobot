import axios from 'axios';

// Use environment variable for API base URL, fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export const apiClient = axios.create({
	baseURL: API_BASE_URL,
	timeout: 30000,
	headers: {
		'Content-Type': 'application/json'
	}
});

// Request interceptor
apiClient.interceptors.request.use(
	(config) => {
		// Add any auth headers here if needed
		return config;
	},
	(error) => {
		return Promise.reject(error);
	}
);

// Response interceptor
apiClient.interceptors.response.use(
	(response) => {
		return response;
	},
	(error) => {
		// Handle common errors
		if (error.response?.status === 401) {
			// Handle unauthorized
		}
		return Promise.reject(error);
	}
);

export default apiClient;