// Zusätzliche Jest-Matcher für das DOM, z. B. expect(element).toBeInTheDocument()
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// jsdom (Jest 27) kennt TextEncoder/TextDecoder nicht, react-router 7 braucht sie beim Laden
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;
