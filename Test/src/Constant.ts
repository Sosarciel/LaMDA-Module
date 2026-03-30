import path from 'pathe';

export const ROOT_PATH = path.join(__dirname,'..');
export const DATA_PATH = path.join(ROOT_PATH,'data');
export const CACHE_PATH = path.join(ROOT_PATH,'cache');

export const LAM_PORT = 3000;
export const KB_PORT = 3001;
export const PG_PORT = 5433;