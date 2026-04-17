import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { hu } from "./hu";
import { en } from "./en";

const savedLang = localStorage.getItem("lang") || "hu";

i18n.use(initReactI18next).init({
  resources: { hu, en },
  lng: savedLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
