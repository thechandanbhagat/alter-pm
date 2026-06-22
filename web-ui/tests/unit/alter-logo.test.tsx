// @group UnitTests : AlterLogo component — brand mark and wordmark rendering

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AlterLogo } from '@/components/AlterLogo'

// @group UnitTests > AlterLogo : Wordmark rendering
describe('AlterLogo', () => {
  it('renders the alter pm wordmark by default', () => {
    render(<AlterLogo />)

    expect(screen.getByText('alter')).toBeInTheDocument()
    expect(screen.getByText('pm')).toBeInTheDocument()
  })

  it('can render only the mark for compact placements', () => {
    const { container } = render(<AlterLogo variant="mark" />)

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByText('alter')).not.toBeInTheDocument()
  })
})
