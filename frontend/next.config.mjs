import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
const config = {};

export default function configure(phase) {
  // Development must not overwrite files that a production preview is serving.
  return phase === PHASE_DEVELOPMENT_SERVER ? { ...config, distDir: '.next-dev' } : config;
}
