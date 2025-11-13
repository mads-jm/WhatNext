/**
 * Shared Core Library
 *
 * This module exports all shared types, protocols, and utilities used across
 * main process, utility process, and renderer process.
 *
 * Design principle: This code must be environment-agnostic (no Node.js-specific
 * or browser-specific APIs). It's pure TypeScript that runs anywhere.
 */

// Types
export * from './types';

// Protocol utilities
export * from './protocol';

// IPC protocol definitions
export * from './ipc-protocol';
