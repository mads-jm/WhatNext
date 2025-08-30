import { URL } from 'url';
import path from 'path';
import { app } from 'electron';

const RESOURCES_PATH = app.isPackaged
	? path.join(process.resourcesPath, 'resources')
	: path.join(__dirname, '../../resources');

export function resolveHtmlPath(htmlFileName: string) {
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT || 1313;
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    return url.href;
  }
  return `file://${path.resolve(__dirname, '../renderer/', htmlFileName)}`;
}

export const getAssetPath = (...paths: string[]): string => {
	return path.join(RESOURCES_PATH, ...paths);
};