import { formatBytes } from '../../utils/formatBytes';

/**
 * 字节大小格式化（文件管理器历史语义：B 整数、KB/MB/GB 1 位小数）
 * 统一走共享 formatBytes 工具，避免与 dashboard 等其他模块重复实现
 */
export const formatSize = (size: number): string => formatBytes(size, 1, 1);

export const formatMode = (mode: number): string => {
  const perm = mode & 0o777;
  let str = '';
  str += perm & 0o400 ? 'r' : '-';
  str += perm & 0o200 ? 'w' : '-';
  str += perm & 0o100 ? 'x' : '-';
  str += perm & 0o040 ? 'r' : '-';
  str += perm & 0o020 ? 'w' : '-';
  str += perm & 0o010 ? 'x' : '-';
  str += perm & 0o004 ? 'r' : '-';
  str += perm & 0o002 ? 'w' : '-';
  str += perm & 0o001 ? 'x' : '-';
  return str;
};

export const FILE_ICON_CLASS_MAP: Record<string, string> = {
  // Images
  jpg: 'fas fa-file-image',
  jpeg: 'fas fa-file-image',
  png: 'fas fa-file-image',
  gif: 'fas fa-file-image',
  bmp: 'fas fa-file-image',
  svg: 'fas fa-file-image',
  webp: 'fas fa-file-image',
  ico: 'fas fa-file-image',
  tiff: 'fas fa-file-image',
  // Videos
  mp4: 'fas fa-file-video',
  mkv: 'fas fa-file-video',
  avi: 'fas fa-file-video',
  mov: 'fas fa-file-video',
  wmv: 'fas fa-file-video',
  flv: 'fas fa-file-video',
  webm: 'fas fa-file-video',
  // Audio
  mp3: 'fas fa-file-audio',
  wav: 'fas fa-file-audio',
  ogg: 'fas fa-file-audio',
  flac: 'fas fa-file-audio',
  aac: 'fas fa-file-audio',
  m4a: 'fas fa-file-audio',
  // Documents
  doc: 'fas fa-file-word',
  docx: 'fas fa-file-word',
  xls: 'fas fa-file-excel',
  xlsx: 'fas fa-file-excel',
  ppt: 'fas fa-file-powerpoint',
  pptx: 'fas fa-file-powerpoint',
  pdf: 'fas fa-file-pdf',
  odt: 'fas fa-file-alt',
  ods: 'fas fa-file-alt',
  odp: 'fas fa-file-alt',
  rtf: 'fas fa-file-alt',
  csv: 'fas fa-file-csv',
  tsv: 'fas fa-file-csv',
  // Archives
  zip: 'fas fa-file-archive',
  rar: 'fas fa-file-archive',
  tar: 'fas fa-file-archive',
  gz: 'fas fa-file-archive',
  '7z': 'fas fa-file-archive',
  bz2: 'fas fa-file-archive',
  xz: 'fas fa-file-archive',
  iso: 'fas fa-compact-disc',
  // Code & Config
  js: 'fab fa-js-square',
  mjs: 'fab fa-js-square',
  cjs: 'fab fa-js-square',
  jsx: 'fab fa-react',
  ts: 'fas fa-file-code',
  tsx: 'fab fa-react',
  vue: 'fab fa-vuejs',
  svelte: 'fas fa-file-code',
  py: 'fab fa-python',
  pyc: 'fab fa-python',
  pyd: 'fab fa-python',
  pyw: 'fab fa-python',
  ipynb: 'fab fa-python',
  java: 'fab fa-java',
  jar: 'fab fa-java',
  class: 'fab fa-java',
  kt: 'fas fa-file-code',
  kts: 'fas fa-file-code',
  cs: 'fas fa-file-code',
  fs: 'fas fa-file-code',
  go: 'fas fa-file-code',
  rs: 'fas fa-file-code',
  c: 'fas fa-file-code',
  h: 'fas fa-file-code',
  cpp: 'fas fa-file-code',
  hpp: 'fas fa-file-code',
  cxx: 'fas fa-file-code',
  hxx: 'fas fa-file-code',
  rb: 'fas fa-gem',
  erb: 'fas fa-gem',
  php: 'fab fa-php',
  swift: 'fab fa-swift',
  scala: 'fas fa-file-code',
  perl: 'fas fa-file-code',
  pl: 'fas fa-file-code',
  lua: 'fas fa-file-code',
  dart: 'fas fa-file-code',
  r: 'fas fa-file-code',
  html: 'fab fa-html5',
  htm: 'fab fa-html5',
  xhtml: 'fab fa-html5',
  css: 'fab fa-css3-alt',
  scss: 'fab fa-sass',
  sass: 'fab fa-sass',
  less: 'fab fa-less',
  styl: 'fas fa-file-code',
  json: 'fas fa-file-code',
  webmanifest: 'fas fa-file-code',
  jsonc: 'fas fa-file-code',
  xml: 'fas fa-file-code',
  xsl: 'fas fa-file-code',
  xsd: 'fas fa-file-code',
  yml: 'fas fa-cog',
  yaml: 'fas fa-cog',
  ini: 'fas fa-cog',
  conf: 'fas fa-cog',
  cfg: 'fas fa-cog',
  config: 'fas fa-cog',
  toml: 'fas fa-cog',
  md: 'fab fa-markdown',
  markdown: 'fab fa-markdown',
  sql: 'fas fa-database',
  ddl: 'fas fa-database',
  db: 'fas fa-database',
  sqlite: 'fas fa-database',
  mdb: 'fas fa-database',
  lock: 'fas fa-lock',
  gitignore: 'fab fa-git-alt',
  gitkeep: 'fab fa-git-alt',
  dockerignore: 'fab fa-docker',
  npmrc: 'fab fa-npm',
  yarnrc: 'fab fa-yarn',
  'pnpmfile.js': 'fas fa-cogs',
  babelrc: 'fas fa-cogs',
  eslintrc: 'fas fa-cogs',
  prettierrc: 'fas fa-cogs',
  stylelintrc: 'fas fa-cogs',
  browserslistrc: 'fas fa-cogs',
  editorconfig: 'fas fa-cog',
  'tsconfig.json': 'fas fa-cogs',
  'jsconfig.json': 'fas fa-cogs',
  'webpack.config.js': 'fas fa-cogs',
  'vite.config.js': 'fas fa-cogs',
  'vite.config.ts': 'fas fa-cogs',
  'rollup.config.js': 'fas fa-cogs',
  'postcss.config.js': 'fas fa-cogs',
  'jest.config.js': 'fas fa-cogs',
  'cypress.json': 'fas fa-cogs',
  'playwright.config.ts': 'fas fa-cogs',
  // Text & Others
  txt: 'fas fa-file-alt',
  text: 'fas fa-file-alt',
  log: 'fas fa-file-alt',
  out: 'fas fa-file-alt',
  err: 'fas fa-file-alt',
  key: 'fas fa-key',
  pem: 'fas fa-key',
  pub: 'fas fa-key',
  asc: 'fas fa-key',
  crt: 'fas fa-certificate',
  cer: 'fas fa-certificate',
  csr: 'fas fa-certificate',
  pfx: 'fas fa-certificate',
  p12: 'fas fa-certificate',
  // Executables & scripts
  exe: 'fas fa-cogs',
  msi: 'fas fa-cogs',
  app: 'fas fa-cogs',
  com: 'fas fa-cogs',
  sh: 'fas fa-terminal',
  bash: 'fas fa-terminal',
  zsh: 'fas fa-terminal',
  fish: 'fas fa-terminal',
  csh: 'fas fa-terminal',
  ksh: 'fas fa-terminal',
  bat: 'fas fa-terminal',
  cmd: 'fas fa-terminal',
  ps1: 'fas fa-terminal',
  psm1: 'fas fa-terminal',
  vb: 'fas fa-file-code',
  vbs: 'fas fa-file-code',
  deb: 'fas fa-archive',
  rpm: 'fas fa-archive',
  pkg: 'fas fa-archive',
  dmg: 'fas fa-compact-disc',
  img: 'fas fa-compact-disc',
  // Fonts
  ttf: 'fas fa-font',
  otf: 'fas fa-font',
  woff: 'fas fa-font',
  woff2: 'fas fa-font',
  eot: 'fas fa-font',
  // Special hidden files (extension is the part after dot)
  bashrc: 'fas fa-cog',
  zshrc: 'fas fa-cog',
  profile: 'fas fa-cog',
  bash_profile: 'fas fa-cog',
  vimrc: 'fas fa-cog',
  screenrc: 'fas fa-cog',
  'tmux.conf': 'fas fa-cog',
  gitconfig: 'fab fa-git-alt',
  npmignore: 'fab fa-npm',
  htaccess: 'fas fa-cog',
  htpasswd: 'fas fa-lock',
  // Default
  default: 'far fa-file',
};

export const getFileIconClassBase = (filename: string): string => {
  const lowerFilename = filename.toLowerCase();
  let extension = '';
  const lastDotIndex = lowerFilename.lastIndexOf('.');

  if (lastDotIndex > 0 && lastDotIndex < lowerFilename.length - 1) {
    extension = lowerFilename.substring(lastDotIndex + 1);
  } else if (lastDotIndex === 0 && lowerFilename.length > 1) {
    extension = lowerFilename.substring(1);
  }

  if (lowerFilename === 'makefile') return 'fas fa-cogs';
  if (lowerFilename === 'dockerfile') return 'fab fa-docker';
  if (lowerFilename.endsWith('docker-compose.yml') || lowerFilename.endsWith('docker-compose.yaml'))
    return 'fab fa-docker';
  if (lowerFilename === 'package.json') return 'fab fa-npm';
  if (lowerFilename === 'package-lock.json') return 'fab fa-npm';
  if (lowerFilename === 'yarn.lock') return 'fab fa-yarn';
  if (lowerFilename === 'composer.json') return 'fab fa-php';
  if (lowerFilename === 'composer.lock') return 'fab fa-php';
  if (lowerFilename === 'gemfile') return 'fas fa-gem';
  if (lowerFilename === 'gemfile.lock') return 'fas fa-gem';
  if (lowerFilename.startsWith('.env')) return 'fas fa-shield-alt';
  if (lowerFilename === '.git') return 'fab fa-git-alt';
  if (lowerFilename === '.gitignore') return 'fab fa-git-alt';
  if (lowerFilename === '.gitattributes') return 'fab fa-git-alt';
  if (lowerFilename === '.gitmodules') return 'fab fa-git-alt';
  if (lowerFilename === 'readme' || lowerFilename.startsWith('readme.'))
    return 'fas fa-book-reader';
  if (lowerFilename === 'license' || lowerFilename.startsWith('license.'))
    return 'fas fa-balance-scale';
  if (lowerFilename === 'contributing' || lowerFilename.startsWith('contributing.'))
    return 'fas fa-users-cog';
  if (lowerFilename === 'code_of_conduct' || lowerFilename.startsWith('code_of_conduct.'))
    return 'fas fa-gavel';
  if (lowerFilename === 'changelog' || lowerFilename.startsWith('changelog.'))
    return 'fas fa-list-alt';
  if (lowerFilename === 'favicon.ico') return 'fas fa-icons';

  return FILE_ICON_CLASS_MAP[extension] || FILE_ICON_CLASS_MAP.default;
};
