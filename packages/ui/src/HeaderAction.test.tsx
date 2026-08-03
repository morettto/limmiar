import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeaderAction } from './HeaderAction'

describe('HeaderAction', () => {
  it('renders its children as the button label', () => {
    render(<HeaderAction>Iniciar sessão</HeaderAction>)
    expect(screen.getByRole('button').textContent).toBe('Iniciar sessão')
  })

  it('calls onClick when activated', () => {
    const onClick = vi.fn()
    render(<HeaderAction onClick={onClick}>Assinar</HeaderAction>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('defaults to type="button" so it never accidentally submits a form', () => {
    render(<HeaderAction>Assinar</HeaderAction>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('button')
  })

  it('accepts type="submit" as an override', () => {
    render(<HeaderAction type="submit">Enviar</HeaderAction>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit')
  })

  it('supports disabled', () => {
    render(<HeaderAction disabled>Aguarde</HeaderAction>)
    expect(screen.getByRole('button', { name: 'Aguarde' })).toHaveProperty('disabled', true)
  })

  it('supports an explicit aria-label (icon-only usage)', () => {
    render(<HeaderAction aria-label="Mais opções">⋮</HeaderAction>)
    expect(screen.getByRole('button', { name: 'Mais opções' })).toBeDefined()
  })

  it('is fixed to the bottom (R4 mobile) at 48px min height, above/outside the base cascade', () => {
    render(<HeaderAction>Assinar</HeaderAction>)
    const className = screen.getByRole('button').className
    expect(className).toContain('fixed')
    expect(className).toContain('bottom-4')
    expect(className).toContain('min-h-12')
  })

  it('sits inline in the header from md up, at the T touch minimum (44px)', () => {
    render(<HeaderAction>Assinar</HeaderAction>)
    const className = screen.getByRole('button').className
    expect(className).toContain('md:static')
    expect(className).toContain('md:min-h-11')
  })

  it('shrinks to the D mouse minimum (32px) from xl', () => {
    render(<HeaderAction>Assinar</HeaderAction>)
    expect(screen.getByRole('button').className).toContain('xl:min-h-8')
  })
})
