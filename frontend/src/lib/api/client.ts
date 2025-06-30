import axios from 'axios';

export const apiClient = axios.create({
	baseURL: 'http://localhost:3000',
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