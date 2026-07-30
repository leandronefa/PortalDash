import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { leerManual } from '../services/manualDoc.js';

const router = Router();
router.use(authMiddleware);

// Sin attachScope ni blockWriteIfSupervisor: el manual no tiene datos de
// sucursal que filtrar y el router no expone escritura. Perfil 8 (supervisor,
// solo lectura) ve exactamente el mismo contenido que cualquier otro usuario.
router.get('/', async (_req, res) => {
  const { markdown, actualizado } = await leerManual();
  res.json({ markdown, actualizado });
});

export default router;
