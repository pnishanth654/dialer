import { config } from '../../config.js';
import { pinataProvider } from './pinata.js';
import { localProvider } from './local.js';

/** Resolves the active Web3 storage provider from config. */
export function web3Provider() {
    switch (config.web3Provider) {
        case 'pinata':
            return pinataProvider;
        case 'local':
            return localProvider;
        default:
            return config.pinataJwt ? pinataProvider : localProvider;
    }
}
