import { siteUrl } from '../../lib/basePath'
import { useState } from 'react'
import './Header.css'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="isu-header">
        <div className="isu-header__inner">
          <a
            href="https://www.iastate.edu"
            className="isu-header__logo"
            aria-label="Iowa State University"
          >
            <img
              src={siteUrl('assets/iastate/iowa-state-university-logo-with-tagline-red.svg')}
              alt="Iowa State University of Science and Technology"
              height="40"
            />
          </a>
          <nav className="isu-header__nav" aria-label="Main navigation">
            <button
              className="isu-header__menu-toggle"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-controls="main-nav"
            >
              <span className="sr-only">Menu</span>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {menuOpen ? (
                  <path d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
            <ul
              id="main-nav"
              className={`isu-header__nav-list ${menuOpen ? 'is-open' : ''}`}
            >
              <li>
                <a href="https://github.com/FriedbergLab/CAFA_forever" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>
              </li>
              <li>
                <a href="https://biofunctionprediction.org/cafa/" target="_blank" rel="noopener noreferrer">
                  CAFA
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </header>
    </>
  )
}
