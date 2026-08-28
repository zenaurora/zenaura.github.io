import assert from "node:assert/strict"
import { test } from "node:test"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveTutorAssetPath } from "./tutor-sites.ts"

const currentDirectory = dirname(fileURLToPath(import.meta.url))

test("accepts a Tutor site beneath tutor-site", () => {
  assert.equal(
    resolveTutorAssetPath("redis-io/"),
    resolve(currentDirectory, "../../tutor-site/redis-io"),
  )
})

test("rejects paths outside tutor-site", () => {
  assert.throws(() => resolveTutorAssetPath("../package.json"), /Forbidden/)
})
