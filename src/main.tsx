import { createRoot } from 'react-dom/client';
import App from './App';
import CharacterPreview from './CharacterPreview';
import './styles.css';
import './theme.css';
const preview = new URLSearchParams(location.search).get('character-preview');
if (preview) document.body.classList.add('preview-document');
createRoot(document.getElementById('root')!).render(preview ? <CharacterPreview id={preview} /> : <App />);
