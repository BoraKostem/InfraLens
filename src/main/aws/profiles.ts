import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AwsProfile } from '@shared/types'

function parseIniSections(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const text = fs.readFileSync(filePath, 'utf8')
  const names = new Set<string>()

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('[') || !line.endsWith(']')) {
      continue
    }

    let name = line.slice(1, -1).trim()
    if (name.startsWith('profile ')) {
      name = name.slice('profile '.length).trim()
    }
    if (name) {
      names.add(name)
    }
  }

  return [...names]
}

function parseConfigRegions(filePath: string): Map<string, string> {
  if (!fs.existsSync(filePath)) {
    return new Map()
  }

  const text = fs.readFileSync(filePath, 'utf8')
  const regions = new Map<string, string>()
  let currentProfile = ''

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      currentProfile = line.slice(1, -1).trim()
      if (currentProfile.startsWith('profile ')) {
        currentProfile = currentProfile.slice('profile '.length).trim()
      }
      continue
    }
    if (!currentProfile) {
      continue
    }
    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (key === 'region' && value) {
      regions.set(currentProfile, value)
    }
  }

  return regions
}

function parseIniFile(filePath: string): Map<string, Map<string, string>> {
  if (!fs.existsSync(filePath)) {
    return new Map()
  }

  const text = fs.readFileSync(filePath, 'utf8')
  const sections = new Map<string, Map<string, string>>()
  let currentSection = ''

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim()
      if (currentSection.startsWith('profile ')) {
        currentSection = currentSection.slice('profile '.length).trim()
      }
      if (!sections.has(currentSection)) {
        sections.set(currentSection, new Map())
      }
      continue
    }
    if (!currentSection) {
      continue
    }
    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    sections.get(currentSection)!.set(key, value)
  }

  return sections
}

export function importAwsConfigFile(filePath: string): string[] {
  const sections = parseIniFile(filePath)
  if (sections.size === 0) {
    throw new Error('No profiles found in the selected file.')
  }

  const awsDir = path.join(os.homedir(), '.aws')
  if (!fs.existsSync(awsDir)) {
    fs.mkdirSync(awsDir, { recursive: true })
  }

  const credentialsPath = path.join(awsDir, 'credentials')
  const configPath = path.join(awsDir, 'config')
  const imported: string[] = []

  for (const [name, fields] of sections) {
    const hasKey = fields.has('aws_access_key_id')
    const hasSecret = fields.has('aws_secret_access_key')
    const region = fields.get('region')

    if (hasKey && hasSecret) {
      appendCredentialSection(credentialsPath, name, {
        aws_access_key_id: fields.get('aws_access_key_id')!,
        aws_secret_access_key: fields.get('aws_secret_access_key')!,
        ...(fields.has('aws_session_token') ? { aws_session_token: fields.get('aws_session_token')! } : {})
      })
    }

    if (region) {
      appendConfigSection(configPath, name, { region })
    }

    imported.push(name)
  }

  return imported
}

export function saveAwsCredentials(profileName: string, accessKeyId: string, secretAccessKey: string): void {
  if (!profileName.trim()) {
    throw new Error('Profile name is required.')
  }
  if (!accessKeyId.trim()) {
    throw new Error('Access Key ID is required.')
  }
  if (!secretAccessKey.trim()) {
    throw new Error('Secret Access Key is required.')
  }

  const awsDir = path.join(os.homedir(), '.aws')
  if (!fs.existsSync(awsDir)) {
    fs.mkdirSync(awsDir, { recursive: true })
  }

  const credentialsPath = path.join(awsDir, 'credentials')
  appendCredentialSection(credentialsPath, profileName.trim(), {
    aws_access_key_id: accessKeyId.trim(),
    aws_secret_access_key: secretAccessKey.trim()
  })
}

function appendCredentialSection(filePath: string, name: string, fields: Record<string, string>): void {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''

  // Remove existing section if present
  const sectionRegex = new RegExp(`(^|\\n)\\[${escapeRegExp(name)}\\][^\\[]*`, 'g')
  content = content.replace(sectionRegex, '$1')
  content = content.replace(/\n{3,}/g, '\n\n').trim()

  const block = `\n\n[${name}]\n` + Object.entries(fields).map(([k, v]) => `${k} = ${v}`).join('\n') + '\n'
  fs.writeFileSync(filePath, content + block, 'utf8')
}

function appendConfigSection(filePath: string, name: string, fields: Record<string, string>): void {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''

  const header = name === 'default' ? `[${name}]` : `[profile ${name}]`
  const sectionRegex = name === 'default'
    ? new RegExp(`(^|\\n)\\[default\\][^\\[]*`, 'g')
    : new RegExp(`(^|\\n)\\[profile ${escapeRegExp(name)}\\][^\\[]*`, 'g')
  content = content.replace(sectionRegex, '$1')
  content = content.replace(/\n{3,}/g, '\n\n').trim()

  const block = `\n\n${header}\n` + Object.entries(fields).map(([k, v]) => `${k} = ${v}`).join('\n') + '\n'
  fs.writeFileSync(filePath, content + block, 'utf8')
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function listAwsProfiles(): AwsProfile[] {
  const awsDir = path.join(os.homedir(), '.aws')
  const configPath = path.join(awsDir, 'config')
  const credentialsPath = path.join(awsDir, 'credentials')
  const configProfiles = parseIniSections(configPath)
  const credentialProfiles = parseIniSections(credentialsPath)
  const regions = parseConfigRegions(configPath)

  const merged = new Map<string, AwsProfile>()

  for (const name of configProfiles) {
    merged.set(name, {
      name,
      source: 'config',
      region: regions.get(name) ?? 'us-east-1'
    })
  }

  for (const name of credentialProfiles) {
    if (!merged.has(name)) {
      merged.set(name, {
        name,
        source: 'credentials',
        region: regions.get(name) ?? 'us-east-1'
      })
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}
