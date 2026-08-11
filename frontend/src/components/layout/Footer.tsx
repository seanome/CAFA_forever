import './Footer.css'

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="site-footer__main">
        <div className="site-footer__inner">
          <div className="site-footer__flex-wrap">
            <a
              href="https://www.iastate.edu"
              className="site-footer__logo-link"
              aria-label="Iowa State University of Science and Technology"
            >
              <img
                src="/assets/iastate/iowa-state-university-logo-with-tagline-sci-tech.svg"
                alt="Iowa State University - Science with Practice"
                className="site-footer__logo"
              />
            </a>
            <div className="site-footer__links">
              <h3 className="site-footer__heading">Resources</h3>
              <ul>
                <li>
                  <a href="https://github.com/FriedbergLab/CAFA_forever" target="_blank" rel="noopener noreferrer">
                    GitHub Repository
                  </a>
                </li>
                <li>
                  <a href="https://biofunctionprediction.org/cafa/" target="_blank" rel="noopener noreferrer">
                    CAFA Challenge
                  </a>
                </li>
                <li>
                  <a href="http://geneontology.org/" target="_blank" rel="noopener noreferrer">
                    Gene Ontology
                  </a>
                </li>
              </ul>
            </div>
            <div className="site-footer__links">
              <h3 className="site-footer__heading">Contact</h3>
              <ul>
                <li>
                  <a href="mailto:idoerg@iastate.edu">
                    idoerg@iastate.edu
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div className="site-footer__bottom-wrap">
        <div className="site-footer__inner site-footer__inner--bottom">
          <p className="site-footer__copyright">
            &copy; {currentYear} Iowa State University of Science and Technology
          </p>
        </div>
      </div>
    </footer>
  )
}
