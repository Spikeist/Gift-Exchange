// The site's only server endpoint: POST /api/exchange with { action, ... }.
import { handle } from '../lib/handler.js';

export default { fetch: handle };
