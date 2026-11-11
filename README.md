# Runners de migraciones y seeds

Dos scripts de Node.js que mantienen sincronizada la base de datos PostgreSQL del proyecto, sin librerías externas de migraciones. Ejecutan archivos `.sql` en orden, recuerdan cuáles ya se aplicaron y protegen cada cambio con una transacción.

Fueron desarrollados a medida, con ayuda de la IA, para tener algo completamente personalizado y no sumar más dependencias al proyecto.

## Qué hacen

| | Migraciones | Seeds |
|---|---|---|
| **Script** | `migrate.js` | `seed.js` |
| **Carpeta de archivos** | `database/migrations/` | `database/seeds/` |
| **Tabla de control** | `migrations` | `seeders` |
| **Para qué sirven** | Cambiar la estructura: tablas, columnas, índices | Cargar datos iniciales: roles, catálogos, usuario administrador |

Ambos runners tienen exactamente la misma lógica; solo cambian la carpeta y la tabla de control.

## Cómo funcionan

Cada vez que se ejecuta un runner:

1. **Prepara:** crea la tabla de control si todavía no existe.
2. **Consulta:** lee de esa tabla qué archivos ya se ejecutaron.
3. **Lista:** toma los archivos `.sql` de la carpeta y los ordena por nombre.
4. **Compara:** omite los que ya están registrados.
5. **Ejecuta:** corre cada archivo pendiente dentro de su propia transacción.
6. **Resume:** muestra cuántos se ejecutaron y cuántos se omitieron, y cierra la conexión.

### Tabla de control

```sql
CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

La tabla `seeders` tiene la misma estructura. `filename` es `UNIQUE`, así que un archivo no puede registrarse dos veces.

### Transacción por archivo

Cada archivo se ejecuta así:

```text
BEGIN
  → SQL del archivo
  → INSERT del nombre en la tabla de control
COMMIT
```

Si algo falla en cualquier punto, se hace `ROLLBACK`: la base queda como estaba y el archivo **no** se registra. Como el registro se guarda dentro de la misma transacción, nunca queda un cambio aplicado sin anotar. Los archivos anteriores que ya terminaron bien se conservan.

## Requisitos

- Node.js con soporte de módulos ES (los scripts usan `import`; el `package.json` debe tener `"type": "module"`).
- PostgreSQL.
- El cliente `pg`, usado desde `database/pool.js`, que exporta el `pool` de conexiones con el que trabajan ambos runners.

## Estructura esperada

```text
proyecto/
├── database/
│   ├── pool.js            # exporta el pool de conexiones a PostgreSQL
│   ├── migrations/        # archivos .sql de estructura
│   │   ├── 001_crear_usuarios.sql
│   │   └── 002_crear_roles.sql
│   └── seeds/             # archivos .sql de datos iniciales
│       └── 001_roles_iniciales.sql
└── <scripts>/
    ├── migrate.js
    └── seed.js
```

Los scripts calculan las rutas a `database/migrations` y `database/seeds` como `../database/...` desde su propia ubicación. Si los ubicas en otra carpeta, ajusta esas rutas y el import de `pool.js`.

## Uso

Desde la raíz del proyecto, con las variables de conexión que lea `database/pool.js` ya configuradas:

```bash
node <carpeta-de-scripts>/migrate.js   # primero, la estructura
node <carpeta-de-scripts>/seed.js      # después, los datos iniciales
```

Opcionalmente, puedes agregar atajos en el `package.json`:

```json
{
  "scripts": {
    "migrate": "node <carpeta-de-scripts>/migrate.js",
    "seed": "node <carpeta-de-scripts>/seed.js"
  }
}
```

Ejecuta primero las migraciones y luego los seeds, porque los seeds suelen necesitar que las tablas ya existan.

## Cómo agregar un cambio

1. Crea un archivo `.sql` nuevo en `database/migrations/` (o en `database/seeds/`).
2. Ponle un prefijo numérico mayor que el del último archivo, para que quede al final del orden: `003_agregar_email.sql`.
3. Escribe el SQL dentro del archivo. No puede estar vacío: un archivo vacío se rechaza con error.
4. Ejecuta el runner. Solo correrá el archivo nuevo.

**Importante:** el orden es alfabético por nombre de archivo, así que usa prefijos con ceros a la izquierda (`001`, `002`, … `010`) o marcas de tiempo (`20261109_1530_...`). Con `1_`, `2_`, `10_` el archivo `10_` se ejecutaría antes que el `2_`.

No edites un archivo que ya se ejecutó: el runner solo guarda el nombre, así que no detectará el cambio. Para modificar algo ya aplicado, crea un archivo nuevo.

## Salida de ejemplo

```text
Iniciando migraciones...

⏩ 001_crear_usuarios.sql (omitida)
▶ Ejecutando 002_crear_roles.sql
✔ 002_crear_roles.sql

==================================
Resumen
==================================
Ejecutados : 1
Omitidos   : 1
==================================
```

Si no hay archivos `.sql` en la carpeta, el runner lo indica y termina sin hacer cambios.

## Cuando una migración falla

- Se hace `ROLLBACK` solo del archivo que falló.
- El runner se detiene: los archivos siguientes no se ejecutan.
- Los archivos anteriores siguen aplicados y registrados.
- Se imprime el error de PostgreSQL en la consola.
- Corrige el archivo que falló (aún no está registrado) y vuelve a ejecutar: solo correrán el corregido y los que faltaban.

## Limitaciones conocidas

- **Código de salida:** los errores se imprimen, pero el proceso termina con código `0`. Si lo usas en CI o en un script de arranque, no detectará el fallo. Una mejora sencilla es establecer `process.exitCode = 1` en el `catch`.
- **Ejecución simultánea:** no hay bloqueo entre instancias. Si dos procesos corren a la vez, podrían intentar aplicar el mismo archivo. `pg_advisory_lock` sería una solución.
- **Sentencias sin transacción:** como cada archivo corre dentro de `BEGIN`/`COMMIT`, no sirven instrucciones que PostgreSQL no permite dentro de una transacción, como `CREATE INDEX CONCURRENTLY`.
- **Sin migraciones inversas:** no existe un comando para deshacer una migración ya aplicada.
- **Sin verificación de contenido:** si se modifica un archivo ya ejecutado, el runner no lo detecta.
