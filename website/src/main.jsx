import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, Download, Files, KeyRound, Mail, MonitorUp, Shield } from "lucide-react";
import "./styles.css";

const email = "chweyahub@gmail.com";
const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${encodeURIComponent("ibia.ai inquiry")}`;

const sections = ["Home", "Use", "Models", "Files", "Contact"];

function App() {
  const [[active, direction], setActive] = useState([0, 0]);
  const [locked, setLocked] = useState(false);
  const touchStart = useRef(null);

  function goTo(index) {
    const next = Math.max(0, Math.min(sections.length - 1, index));
    if (next === active) return;
    setActive([next, next > active ? 1 : -1]);
    setLocked(true);
    window.setTimeout(() => setLocked(false), 560);
  }

  useEffect(() => {
    const onWheel = (event) => {
      event.preventDefault();
      if (locked || Math.abs(event.deltaY) < 12) return;
      goTo(active + (event.deltaY > 0 ? 1 : -1));
    };

    const onKey = (event) => {
      if (["ArrowDown", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        goTo(active + 1);
      }
      if (["ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        goTo(active - 1);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [active, locked]);

  return (
    <main
      className="site"
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientY ?? null;
      }}
      onTouchEnd={(event) => {
        if (touchStart.current === null || locked) return;
        const end = event.changedTouches[0]?.clientY ?? touchStart.current;
        const delta = touchStart.current - end;
        touchStart.current = null;
        if (Math.abs(delta) > 42) goTo(active + (delta > 0 ? 1 : -1));
      }}
    >
      <Header active={active} goTo={goTo} />
      <Dots active={active} goTo={goTo} />

      <AnimatePresence mode="wait" custom={direction}>
        <motion.section
          key={active}
          className="panel"
          custom={direction}
          initial={{ opacity: 0, y: direction > 0 ? 28 : -28 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: direction > 0 ? -28 : 28 }}
          transition={{ duration: 0.42, ease: [0.22, 0.8, 0.2, 1] }}
        >
          {active === 0 && <Hero onNext={() => goTo(1)} />}
          {active === 1 && <UseSection />}
          {active === 2 && <ModelsSection />}
          {active === 3 && <FilesSection />}
          {active === 4 && <ContactSection />}
        </motion.section>
      </AnimatePresence>
    </main>
  );
}

function Header({ active, goTo }) {
  return (
    <header className="header">
      <button className="brand" onClick={() => goTo(0)} aria-label="Go home">
        <Wordmark compact />
      </button>
      <nav aria-label="Sections">
        {sections.map((section, index) => (
          <button key={section} className={active === index ? "active" : ""} onClick={() => goTo(index)}>
            {section}
          </button>
        ))}
      </nav>
      <a className="contactButton" href={gmailUrl} target="_blank" rel="noreferrer">
        <Mail size={17} />
        Contact
      </a>
    </header>
  );
}

function Dots({ active, goTo }) {
  return (
    <aside className="dots" aria-label="Page progress">
      {sections.map((section, index) => (
        <button key={section} className={active === index ? "active" : ""} onClick={() => goTo(index)} aria-label={section} />
      ))}
    </aside>
  );
}

function Hero({ onNext }) {
  return (
    <div className="hero">
      <Wordmark />
      <p className="kicker">A desktop AI assistant for local and cloud models.</p>
      <h1>Ask without leaving your work.</h1>
      <p className="bodyText">
        ibia.ai opens with a shortcut, searches the files you choose, and answers through Ollama locally or your saved API keys.
      </p>
      <div className="actions">
        <a className="primary" href="#">
          <Download size={18} />
          Download for Windows
        </a>
        <button className="secondary" onClick={onNext}>
          Learn more
          <ArrowDown size={17} />
        </button>
      </div>
    </div>
  );
}

function UseSection() {
  return (
    <SimpleSection
      icon={<MonitorUp />}
      eyebrow="Shortcut"
      title="Press Ctrl + Alt + I."
      text="ibia.ai appears as a small floating window, then gets out of the way when you are done."
      detail="Built for quick questions, rewriting, summaries, explanations, and code help."
    />
  );
}

function ModelsSection() {
  return (
    <SimpleSection
      icon={<Shield />}
      eyebrow="Models"
      title="Local first. Cloud optional."
      text="Use Ollama once it is installed, or add API keys for OpenAI, Claude, Grok, and DeepSeek."
      detail="Choose privacy, speed, or model quality depending on the task."
    />
  );
}

function FilesSection() {
  return (
    <SimpleSection
      icon={<Files />}
      eyebrow="Files"
      title="Your notes become context."
      text="Add study material, code, PDFs, and drafts. ibia.ai searches relevant chunks before answering."
      detail="Useful for revision, projects, writing, and everyday desktop work."
    />
  );
}

function ContactSection() {
  return (
    <div className="contactPanel">
      <Wordmark />
      <h2>Let’s talk about ibia.ai.</h2>
      <p className="bodyText">Send feedback, ask for early access, or talk about the next version.</p>
      <div className="actions">
        <a className="primary" href={gmailUrl} target="_blank" rel="noreferrer">
          <Mail size={18} />
          Open Gmail
        </a>
        <a className="secondary" href={`mailto:${email}`}>
          {email}
        </a>
      </div>
    </div>
  );
}

function SimpleSection({ icon, eyebrow, title, text, detail }) {
  return (
    <div className="simple">
      <div className="icon">{icon}</div>
      <p className="kicker">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="bodyText">{text}</p>
      <p className="fineText">{detail}</p>
    </div>
  );
}

function Wordmark({ compact = false }) {
  return (
    <span className={compact ? "wordmark compact" : "wordmark"} aria-hidden="true">
      <span className="letterI">
        <span className="wordDot blue" />
        <span className="wordStem" />
      </span>
      <span>b</span>
      <span className="letterI">
        <span className="wordDot dark" />
        <span className="wordStem" />
      </span>
      <span>a</span>
    </span>
  );
}

createRoot(document.getElementById("root")).render(<App />);
