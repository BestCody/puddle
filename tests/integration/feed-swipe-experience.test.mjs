import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Feed shows the post title and uses a consistent icon treatment without changing actions', async () => {
  const [client, share, styles] = await Promise.all([
    read('components/social-feed-client.js'),
    read('app/(product)/map/feed-share-menu.js'),
    read('app/(product)/map/MapFeed.module.css')
  ])

  assert.match(client, /<h2 className=\{styles\.postTitle\}>\{title\}<\/h2>/)
  assert.match(client, /className=\{styles\.actionButton\}[^>]*href=\{href\}/)
  assert.match(client, /styles\.actionButton[^\n]*post\.saved/)
  assert.match(client, /<CommentIcon \/>/)
  assert.match(client, /<OpenPuddleIcon \/>/)
  assert.match(client, /<SaveIcon saved=\{post\.saved\} \/>/)
  assert.match(share, /function ShareIcon\(\)/)
  assert.match(share, /className=\{styles\.actionButton\}/)
  assert.match(styles, /\.postTitle\s*\{[\s\S]*font:\s*800\s+clamp\(/)
  assert.match(styles, /\.actionButton\s*\{[\s\S]*min-width:\s*2\.25rem/)
  assert.match(styles, /\.actionIcon\s*\{[\s\S]*stroke-width:\s*1\.75/)
})

test('Swipe keeps the next card mounted behind the active card and exits by viewport geometry', async () => {
  const [workspace, card, styles] = await Promise.all([
    read('components/date-swipe-workspace-v2.js'),
    read('components/figma-swipe-card.js'),
    read('app/figma-dashboard-rebuild.css')
  ])

  assert.match(workspace, /const next = feed\.items\[index \+ 1\] \|\| null/)
  assert.match(workspace, /className=\{`figma-swipe-card-stage\$\{cardLeaving \? ' is-swiping' : ''\}`\}/)
  assert.match(workspace, /preview \/>/)
  assert.match(card, /preview = false/)
  assert.match(card, /function exitOffset\(direction\)/)
  assert.match(card, /Math\.hypot\(rect\.width, rect\.height\)/)
  assert.match(card, /setDragX\(exitOffset\(direction\)\)/)
  assert.match(card, /is-leaving/)
  assert.doesNotMatch(card, /-720|720/)
  assert.match(styles, /\.figma-swipe-card\.is-preview\s*\{[\s\S]*transform:\s*translateY\(/)
  assert.match(styles, /\.figma-swipe-card-stage\.is-swiping > \.figma-swipe-card\.is-preview\s*\{[\s\S]*scale\(1\)/)
  assert.match(styles, /\.figma-swipe-card\.is-leaving\s*\{[\s\S]*transition:/)
})
