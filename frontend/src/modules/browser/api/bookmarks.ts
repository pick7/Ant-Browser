import type { BrowserBookmark } from '../types'
import { getBindings } from './runtime'

export async function fetchBookmarks(): Promise<BrowserBookmark[]> {
  const bindings: any = await getBindings()
  if (bindings?.BookmarkList) {
    return (await bindings.BookmarkList()) || []
  }
  return [
    { name: 'Google', url: 'https://www.google.com/' },
    { name: 'Gmail', url: 'https://mail.google.com/' },
    { name: 'Claude', url: 'https://claude.ai/' },
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'YouTube', url: 'https://www.youtube.com/' },
  ]
}

export async function saveBookmarks(items: BrowserBookmark[]): Promise<boolean> {
  const bindings: any = await getBindings()
  if (bindings?.BookmarkSave) {
    await bindings.BookmarkSave(items)
    return true
  }
  return true
}

export async function resetBookmarks(): Promise<boolean> {
  const bindings: any = await getBindings()
  if (bindings?.BookmarkReset) {
    await bindings.BookmarkReset()
    return true
  }
  return true
}
