import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function getSessionStatusColor(status: string) {
	switch (status) {
		case 'running':
			return 'bg-green-500';
		case 'ready':
			return 'bg-blue-500';
		case 'error':
			return 'bg-red-500';
		case 'terminating':
			return 'bg-yellow-500';
		case 'terminated':
			return 'bg-gray-500';
		default:
			return 'bg-gray-400';
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
