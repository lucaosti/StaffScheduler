/**
 * Keeps `<html dir>` and `lang` in sync with the active i18next locale.
 *
 * Mounted once near the root of `App.tsx`. Renders nothing; it exists only
 * for the effect. `dir="rtl"` must live on `<html>` (not a nested wrapper)
 * so the whole document — including anything portaled outside the React
 * tree, like Bootstrap modals — inherits the correct writing direction.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isRtl } from './index';

const DirectionSync: React.FC = () => {
  const { i18n } = useTranslation();

  useEffect(() => {
    const applyDirection = (locale: string): void => {
      const dir = isRtl(locale) ? 'rtl' : 'ltr';
      document.documentElement.setAttribute('dir', dir);
      document.documentElement.setAttribute('lang', locale);
    };

    applyDirection(i18n.language);
    i18n.on('languageChanged', applyDirection);
    return () => {
      i18n.off('languageChanged', applyDirection);
    };
  }, [i18n]);

  return null;
};

export default DirectionSync;
