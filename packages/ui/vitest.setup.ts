import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Every component test file in src/ renders into the same jsdom document;
// without this, a 2nd/3rd render in the same file leaks the previous
// render's DOM and text queries start matching multiple elements.
afterEach(cleanup)
