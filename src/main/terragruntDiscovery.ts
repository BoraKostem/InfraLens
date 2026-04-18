import fs from 'node:fs'
import path from 'node:path'

import type {
  TerragruntDependency,
  TerragruntDiscoveryResult,
  TerragruntGeneratedFile,
  TerragruntIncludeRef,
  TerragruntRemoteState,
  TerragruntUnit
} from '@shared/types'

const TERRAGRUNT_CONFIG_FILE = 'terragrunt.hcl'
const MAX_WALK_DEPTH = 12
const IGNORE_DIRS = new Set(['.git', '.terraform', '.terragrunt-cache', 'node_modules', '.idea', '.vscode'])

function readFileSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf-8') } catch { return '' }
}

function stripComments(source: string): string {
  // Remove line comments (# and //) and block comments (/* */).
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/(^|\s)#[^\n]*/g, '$1')
}

function extractStringAttribute(body: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`)
  return body.match(re)?.[1] ?? ''
}

function extractRawAttribute(body: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*([^\\n]+)`)
  return body.match(re)?.[1]?.trim() ?? ''
}

function hasAttribute(body: string, attr: string): boolean {
  const re = new RegExp(`\\b${attr}\\s*=`)
  return re.test(body)
}

function findBlocksByKeyword(
  source: string,
  keyword: string
): Array<{ label: string; body: string }> {
  const results: Array<{ label: string; body: string }> = []
  const pattern = new RegExp(`\\b${keyword}\\s*(?:"([^"]*)"\\s*)?\\{`, 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const startAfterBrace = match.index + match[0].length
    const body = extractBalancedBody(source, startAfterBrace)
    if (body === null) continue
    results.push({ label: match[1] ?? '', body })
  }
  return results
}

function extractBalancedBody(source: string, startIndex: number): string | null {
  let depth = 1
  let inString = false
  let i = startIndex
  while (i < source.length && depth > 0) {
    const ch = source[i]
    if (inString) {
      if (ch === '\\') { i += 2; continue }
      if (ch === '"') inString = false
    } else {
      if (ch === '"') inString = true
      else if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
    }
    i += 1
  }
  if (depth !== 0) return null
  return source.slice(startIndex, i - 1)
}

function parseIncludeBlocks(source: string): TerragruntIncludeRef[] {
  return findBlocksByKeyword(source, 'include').map((block) => {
    const pathExpression = extractRawAttribute(block.body, 'path')
    const resolvedPath = extractStringAttribute(block.body, 'path')
    const expose = /expose\s*=\s*true/.test(block.body)
    const mergeStrategy = extractStringAttribute(block.body, 'merge_strategy')
    return {
      name: block.label || 'root',
      pathExpression,
      resolvedPath,
      expose,
      mergeStrategy
    }
  })
}

function parseDependencyBlocks(source: string): TerragruntDependency[] {
  return findBlocksByKeyword(source, 'dependency').map((block) => {
    const configPath = extractStringAttribute(block.body, 'config_path')
    return {
      name: block.label || '',
      configPath,
      resolvedPath: '',
      skipOutputs: /skip_outputs\s*=\s*true/.test(block.body),
      hasMockOutputs: hasAttribute(block.body, 'mock_outputs')
    }
  })
}

function parseAdditionalDependencyPaths(source: string): string[] {
  const blocks = findBlocksByKeyword(source, 'dependencies')
  const paths: string[] = []
  for (const block of blocks) {
    const listMatch = block.body.match(/paths\s*=\s*\[([^\]]*)\]/)
    if (!listMatch) continue
    const items = listMatch[1].match(/"([^"]+)"/g)
    if (!items) continue
    for (const item of items) {
      paths.push(item.slice(1, -1))
    }
  }
  return paths
}

function parseGenerateBlocks(source: string): TerragruntGeneratedFile[] {
  return findBlocksByKeyword(source, 'generate').map((block) => ({
    name: block.label || '',
    targetPath: extractStringAttribute(block.body, 'path'),
    ifExists: extractStringAttribute(block.body, 'if_exists')
  }))
}

function parseRemoteStateBlock(source: string): TerragruntRemoteState | null {
  const blocks = findBlocksByKeyword(source, 'remote_state')
  if (blocks.length === 0) return null
  const body = blocks[0].body
  const backend = extractStringAttribute(body, 'backend')
  const generateBlocks = findBlocksByKeyword(body, 'generate')
  const generatedTargetPath = generateBlocks.length > 0
    ? extractStringAttribute(generateBlocks[0].body, 'path')
    : ''
  const configBlocks = findBlocksByKeyword(body, 'config')
  const configSummary: Record<string, string> = {}
  if (configBlocks.length > 0) {
    const configBody = configBlocks[0].body
    const attrRe = /(\w+)\s*=\s*"([^"]*)"/g
    let attrMatch: RegExpExecArray | null
    while ((attrMatch = attrRe.exec(configBody)) !== null) {
      configSummary[attrMatch[1]] = attrMatch[2]
    }
  }
  return { backend, generatedTargetPath, configSummary }
}

function parseTerraformSource(source: string): string {
  const blocks = findBlocksByKeyword(source, 'terraform')
  if (blocks.length === 0) return ''
  return extractStringAttribute(blocks[0].body, 'source')
}

export function parseTerragruntFile(configFile: string): Omit<TerragruntUnit, 'unitPath' | 'relativePath'> {
  const raw = readFileSafe(configFile)
  const source = stripComments(raw)
  return {
    configFile,
    terraformSource: parseTerraformSource(source),
    includes: parseIncludeBlocks(source),
    dependencies: parseDependencyBlocks(source),
    additionalDependencyPaths: parseAdditionalDependencyPaths(source),
    generatedFiles: parseGenerateBlocks(source),
    remoteState: parseRemoteStateBlock(source),
    inputs: [],
    resolvedAt: '',
    resolveError: ''
  }
}

function walkForConfigs(rootPath: string, errors: string[]): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      errors.push(`Failed to read ${dir}: ${(err as Error).message}`)
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        walk(path.join(dir, entry.name), depth + 1)
      } else if (entry.isFile() && entry.name === TERRAGRUNT_CONFIG_FILE) {
        found.push(path.join(dir, entry.name))
      }
    }
  }
  walk(rootPath, 0)
  return found
}

function buildUnit(configFile: string, stackRoot: string): TerragruntUnit {
  const unitDir = path.dirname(configFile)
  const relativePath = path.relative(stackRoot, unitDir) || '.'
  return {
    unitPath: unitDir,
    relativePath,
    ...parseTerragruntFile(configFile)
  }
}

export function scanForTerragrunt(rootPath: string): TerragruntDiscoveryResult {
  const absoluteRoot = path.resolve(rootPath)
  const errors: string[] = []

  if (!fs.existsSync(absoluteRoot)) {
    return { rootPath: absoluteRoot, classification: 'none', stackRoot: '', units: [], errors: ['Root path does not exist.'] }
  }

  const configs = walkForConfigs(absoluteRoot, errors)
  if (configs.length === 0) {
    return { rootPath: absoluteRoot, classification: 'none', stackRoot: '', units: [], errors }
  }

  const rootConfig = path.join(absoluteRoot, TERRAGRUNT_CONFIG_FILE)
  const rootHasConfig = fs.existsSync(rootConfig)
  const descendantConfigs = configs.filter((c) => path.dirname(c) !== absoluteRoot)

  if (descendantConfigs.length === 0 && rootHasConfig) {
    const unit = buildUnit(rootConfig, absoluteRoot)
    return {
      rootPath: absoluteRoot,
      classification: 'unit',
      stackRoot: absoluteRoot,
      units: [unit],
      errors
    }
  }

  const stackRoot = absoluteRoot
  const units = descendantConfigs
    .map((configFile) => buildUnit(configFile, stackRoot))
    .filter((unit) => unit.terraformSource !== '' || unit.includes.length > 0)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  // The root terragrunt.hcl (if present) is not a runnable unit, but it may carry shared
  // `inputs = { … }`, `locals`, `remote_state`, and `generate` blocks that every child
  // inherits. Surface it so the Inputs dialog can render its values alongside the per-unit view.
  const rootUnit: TerragruntUnit | null = rootHasConfig
    ? buildUnit(rootConfig, stackRoot)
    : null

  return {
    rootPath: absoluteRoot,
    classification: 'stack',
    stackRoot,
    units,
    rootConfig: rootUnit,
    errors
  }
}
