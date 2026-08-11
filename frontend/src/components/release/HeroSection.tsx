import { useState } from 'react'
import { Section } from '../layout'
import './HeroSection.css'

export function HeroSection() {
  const [showLearnMore, setShowLearnMore] = useState(false)

  return (
    <Section variant="hero" id="hero">
      <div className="hero">
        <h1 className="hero__acronym">
          <span className="hero__acronym-letter">L</span>ongitudinal{' '}
          <span className="hero__acronym-letter">A</span>ssessment of{' '}
          <span className="hero__acronym-letter">F</span>unction{' '}
          <span className="hero__acronym-letter">A</span>nnotation
        </h1>
        <p className="viewing-note">
          (Best viewed on a laptop or desktop. Mobile users should use landscape orientation)
        </p>
        <p className="hero__description">
          A persistent benchmarking system for protein function prediction methods.
          Unlike CAFA's triennial challenges, LAFA continuously evaluates methods
          as new ground truth annotations accumulate.
        </p>

        <div className="hero__badges">
          <a
            href="https://arxiv.org/abs/2604.20782"
            target="_blank"
            rel="noopener noreferrer"
            className="hero__badge hero__badge--secondary"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Read the Paper
          </a>
          <button
            className="hero__badge hero__badge--button"
            onClick={() => setShowLearnMore(!showLearnMore)}
            aria-expanded={showLearnMore}
          >
            {showLearnMore ? 'Hide Details' : 'How It Works'}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={showLearnMore ? 'hero__chevron--up' : ''}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <a
            href="https://github.com/FriedbergLab/LAFA_container_guide"
            target="_blank"
            rel="noopener noreferrer"
            className="hero__badge hero__badge--secondary"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Submit Your Method
          </a>
        </div>

        {showLearnMore && (
          <div className="hero__learn-more">
            <div className="hero__learn-more-section">
              <h4>Gene Ontology & Protein Function Prediction</h4>
              <p>
                The <strong>Gene Ontology (GO)</strong> is a structured vocabulary describing
                protein functions across three aspects: <em>Biological Process</em> (BP) describes
                large processes accomplished by multiple molecular activities, <em>Molecular Function</em> (MF) describes 
                molecular-level activities performed by gene products, and <em>Cellular Component</em> (CC) 
                describes the cellular location where a molecular function takes place.
                GO terms are organized in a directed acyclic graph where child terms inherit
                properties from their ancestors. If a protein performs a specific function,
                it implicitly performs all parent functions.
              </p>
              <p>  
                <strong>Protein function prediction</strong> is the computational task of assigning GO 
                terms to proteins based on various data sources such as amino acid sequence,
                3D structure, interaction networks, and literature. Accurate function prediction
                is crucial for understanding biology and disease, but it is challenging due to
                the vast diversity of protein functions and the incomplete nature of experimental annotations.
                The <strong>Critical Assessment of Function Annotation (CAFA)</strong> is a community challenge that evaluates
                computational methods for protein function prediction using a time-delayed evaluation framework.
              </p>
            </div>
            <div className="hero__learn-more-section">
              <h4>Evaluation of Prediction Methods</h4>
              <p>
                Predictions are evaluated on future annotations, which accumulate between two
                time points: <strong>Start (t0)</strong> when predictions are made, and <strong>End (t1)</strong> when new experimental annotations 
                accumulate. Longer windows provide a larger set of annotations and a more robust evaluation.
              </p>
              <p>  
                Predictions in protein-term-score format are compared with the corresponding protein-term 
                ground truth over score thresholds from 0 to 1 in increments of 0.01. This produces threshold-dependent <strong> 
                precision, recall, and F1 scores</strong>. CAFA-style evaluation also uses information-theoretic weighting 
                to emphasize the correct prediction of more specific terms.
              </p>
            </div>
            <div className="hero__learn-more-section">
              <h4>Knowledge Subsets</h4>
              <p>
                Proteins are classified by their annotation status at prediction time (t0) and 
                after the accumulation period (t1). The classification is crucial because methods 
                that rely on sequence homology or existing annotations may perform differently when 
                existing annotations are unavailable.
              </p>
              <dl className="hero__definitions">
                <div>
                  <dt>NK (No Knowledge)</dt>
                  <dd>
                    Proteins with no existing experimental GO annotations
                    at t0. This knowledge setting tests a method's ability to predict function purely 
                    from sequence or structure without functional hints.
                  </dd>
                </div>
                <div>
                  <dt>LK (Limited Knowledge)</dt>
                  <dd>
                    Proteins with experimental annotations at t0 in at least 
                    one GO aspect and gain additional aspects after accumulation period. Methods can leverage 
                    the existing annotations to predict additional functions in the remaining unannotated aspects.
                  </dd>
                </div>
                <div>
                  <dt>PK (Partial Knowledge)</dt>
                  <dd>
                    Proteins with existing experimental annotations
                    and gain deeper annotations after accumulation period. This is the most challenging subset,
                    testing a method's ability to discover more specific functions beyond what is already known.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}
