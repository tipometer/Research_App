export const hu = {
  translation: {
    // Navigation
    nav: {
      dashboard: "Irányítópult",
      newResearch: "Új kutatás",
      brainstorm: "Ötletgyár",
      billing: "Számlázás",
      admin: "Admin",
      profile: "Profil",
      logout: "Kijelentkezés",
      login: "Bejelentkezés",
    },
    // Landing
    landing: {
      hero: {
        title: "Mélykutatás AI-val",
        subtitle: "Fedezd fel a legjövedelmezőbb piaci réseket egy 4-fázisú AI kutatási pipeline segítségével, valós emberi visszajelzésekkel kiegészítve.",
        cta: "Kezdj kutatást ingyen",
        watchDemo: "Nézd meg a demót",
      },
      features: {
        pipeline: { title: "4-fázisú Pipeline", desc: "Wide Scan → Gap Detection → Deep Dives → Synthesis" },
        radar: { title: "5-dimenziós Értékelés", desc: "Radardiagram: Piaci méret, Verseny, Megvalósíthatóság, Monetizáció, Időszerűség" },
        polling: { title: "Emberi Validáció", desc: "Generálj megosztható kérdőívet és integráld a válaszokat a kutatásba" },
        security: { title: "Enterprise Biztonság", desc: "GDPR megfelelőség, OWASP Top 10 védelem, szerver oldali AI végrehajtás" },
      },
    },
    // Dashboard
    dashboard: {
      title: "Irányítópult",
      credits: "Kredit egyenleg",
      newResearch: "Új kutatás",
      recentResearches: "Legutóbbi kutatások",
      noResearches: "Még nincs kutatásod. Indíts egyet!",
      status: {
        pending: "Várakozik",
        running: "Fut",
        done: "Kész",
        failed: "Sikertelen",
      },
    },
    // New Research
    newResearch: {
      title: "Új kutatás indítása",
      nicheName: "Niche neve",
      nicheNamePlaceholder: "pl. AI önéletrajz készítő alkalmazás",
      description: "Leírás",
      descriptionPlaceholder: "Írd le a célközönséget, a problémát és a megoldást...",
      strategy: "Kutatási stratégia",
      strategies: {
        gaps: "Kielégítetlen piaci igények keresése",
        predator: "Versenytárs elemzés (Predator)",
        provisioning: "Ellátási lánc feltérképezése",
      },
      batchMode: "Batch mód (több kutatás egyszerre)",
      creditCost: "Kredit költség",
      start: "Kutatás indítása",
      insufficientCredits: "Nincs elég kredited. Tölts fel!",
    },
    // Research Progress
    progress: {
      title: "Kutatás folyamatban...",
      phases: {
        wide_scan: "Széles körű keresés",
        gap_detection: "Piaci rések azonosítása",
        deep_dives: "Mélyelemzés",
        synthesis: "Szintézis",
      },
      sourcesFound: "Forrás megtalálva",
      keywords: "Kulcsszavak",
      duration: "Időtartam",
      failed: "A kutatás sikertelen. A kreditek visszatérítve.",
      retry: "Újra próbálkozás",
    },
    // Report
    report: {
      verdict: {
        GO: "GO",
        KILL: "KILL",
        CONDITIONAL: "FELTÉTELES",
      },
      verdictDesc: {
        GO: "Erős piaci lehetőség, érdemes belevágni!",
        KILL: "Gyenge kilátások, nem ajánlott.",
        CONDITIONAL: "Ígéretes, de további validáció szükséges.",
      },
      radarAxes: {
        marketSize: "Piaci méret",
        competition: "Verseny",
        feasibility: "Megvalósíthatóság",
        monetization: "Monetizáció",
        timeliness: "Időszerűség",
      },
      sources: "Forráskönyvtár",
      sourceTypes: {
        academic: "Tudományos",
        industry: "Iparági",
        news: "Hírek",
        blog: "Blog",
        community: "Közösség",
      },
      export: {
        pdf: "PDF letöltés",
        markdown: "Markdown letöltés",
        share: "Megosztás",
        copied: "Link másolva!",
      },
      polling: {
        title: "Emberi validáció",
        start: "Primer kutatás indítása",
        shareLink: "Kérdőív link másolása",
        responses: "beérkezett válasz",
        importCSV: "CSV importálás",
        resynthesize: "Kutatás frissítése a válaszok alapján",
        synthesizing: "Elemzés folyamatban...",
      },
    },
    // Brainstorm
    brainstorm: {
      title: "Ötletgyár",
      contextLabel: "Kontextus",
      contextPlaceholder: "Iparág, célközönség, korlátok...",
      generate: "10 ötlet generálása",
      generating: "Generálás...",
      saveIdea: "Mentés",
      sendToResearch: "Kutatásba küldés",
      refine: "Finomítás",
    },
    // Billing
    billing: {
      title: "Kredit vásárlás",
      balance: "Jelenlegi egyenleg",
      packages: "Kredit csomagok",
      history: "Tranzakció előzmények",
      buy: "Megvásárlás",
      invoice: "Számla letöltése",
    },
    // Admin
    admin: {
      title: "Admin panel",
      users: "Felhasználók",
      researches: "Kutatások",
      aiConfig: "AI konfiguráció",
      auditLogs: "Audit naplók",
      providers: "Szolgáltatók",
      modelRouting: "Modell routing",
      prompts: "Promptok",
      testConnection: "Kapcsolat tesztelése",
      saveConfig: "Konfiguráció mentése",
    },
    // Auth
    auth: {
      login: "Bejelentkezés",
      register: "Regisztráció",
      email: "Email cím",
      password: "Jelszó",
      confirmPassword: "Jelszó megerősítése",
      loginWithGoogle: "Bejelentkezés Google-lal",
      loginWithFacebook: "Bejelentkezés Facebookkal",
      forgotPassword: "Elfelejtett jelszó",
      passwordStrength: {
        weak: "Gyenge",
        medium: "Közepes",
        strong: "Erős",
      },
    },
    // Common
    common: {
      loading: "Betöltés...",
      save: "Mentés",
      cancel: "Mégse",
      delete: "Törlés",
      edit: "Szerkesztés",
      close: "Bezárás",
      back: "Vissza",
      next: "Következő",
      search: "Keresés",
      filter: "Szűrés",
      export: "Exportálás",
      comingSoon: "Hamarosan elérhető",
      error: "Hiba történt",
      success: "Sikeres!",
      confirm: "Megerősítés",
    },
  },
};
