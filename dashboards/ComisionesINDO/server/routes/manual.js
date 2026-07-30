import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { leerManual } from '../services/manualDoc.js';

const router = Router();
router.use(authMiddleware);

// Sin attachScope ni blockWriteIfSupervisor: el manual no tiene datos de
// sucursal que filtrar y el router no expone escritura. Perfil 8 (supervisor,
// solo lectura) ve exactamente el mismo contenido que cualquier otro usuario.
router.get('/', async (_req, res) => {
  const { ok, markdown, actualizado } = await leerManual();
  // Sin cache: la promesa de la arquitectura es "editar el .md y recargar la
  // página", sin rebuild ni reinicio — una respuesta cacheada (por el navegador
  // o por el proxy YARP del portal) la rompería.
  res.set('Cache-Control', 'no-store');
  res.json({ ok, markdown, actualizado });
});

export default router;
