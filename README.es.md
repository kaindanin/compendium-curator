# Compendium Curator

**Español** | [English](README.md)

## ¿Qué es Compendium Curator?

Compendium Curator mejora el Navegador de Compendios de D&D5e permitiendo al director de juego ocultar entradas concretas de los compendios instalados sin modificar ni duplicar su contenido original.

Crea perfiles independientes para distintas campañas, mundos o ambientaciones, y controla qué objetos, conjuros, rasgos y demás entradas pueden encontrar los jugadores en el Navegador de Compendios.

Olvídate de invertir horas creando y organizando compendios personalizados solo para combinar contenido seleccionado de diferentes libros. Elige lo que no quieres mostrar, ocúltalo y mantén el Navegador de Compendios limpio y adaptado a cada campaña.

## Funciones

* Ocultar entradas individuales del Navegador de Compendios.
* Restaurar entradas ocultas.
* Seleccionar varias entradas mediante casillas.
* Seleccionar todas las entradas visibles mediante una casilla general.
* Filtrar entradas ocultas con el control nativo de tres estados del Navegador de Compendios.
* Identificar visualmente las entradas ocultas.
* Crear y eliminar perfiles de configuración.
* Mantener listas de entradas ocultas independientes para cada perfil.
* Elegir un perfil público fijo para los jugadores.
* Permitir que el GM cambie de perfil de trabajo sin alterar lo que ven los jugadores.
* Sincronizar los cambios automáticamente entre los clientes conectados.
* Limitar los controles de administración a usuarios con permiso para modificar los ajustes del mundo.
* Mantener los datos guardados entre sesiones.
* Limitar la previsualización de cada entrada a su nombre para que no interfiera con los controles.
* Renombrar y duplicar perfiles.
* Exportar e importar perfiles.
* Detectar y agrupar entradas duplicadas dentro de los resultados actuales del navegador.
* Definir una prioridad global de fuentes para decidir qué copia conservar.
* Seleccionar automáticamente las copias de menor prioridad para ocultarlas.
* Detectar duplicados con traducciones diferentes.
* Mostrar indicadores de carga durante operaciones largas.
* Crear tablas de contenido y tablas compuestas desde el propio Navegador de Compendios.
* Organizar visualmente las tablas en carpetas y reproducir esa estructura en su primera generación.
* Seleccionar, generar, mover o eliminar varios perfiles de tabla a la vez, incluida la generación por carpeta.
* Consultar las categorías reutilizables como tarjetas compactas desplegables y organizarlas en carpetas visuales independientes.
* Aplicar filtros globales a todas las categorías de una tabla y revisarlos en su vista previa.
* Configurar categorías, pesos, reglas de objetos, exclusiones y tablas enlazadas desde una única vista.
* Exportar una tabla o realizar una copia completa del Gestor con sus carpetas y valores predeterminados.

## Requisitos

* Foundry Virtual Tabletop 14 o superior.
* Sistema D&D5e 5.3.0 o superior.

## Instalación manual

1. Descarga o copia la carpeta del módulo.

2. Colócala dentro de la carpeta de módulos de Foundry:

   ```text
   Data/modules/compendium-curator
   ```

3. Reinicia Foundry Virtual Tabletop.

4. Activa **Compendium Curator** desde la configuración de módulos del mundo.

## Uso

Abre el Navegador de Compendios de D&D5e.

En la parte superior aparecerán los controles de Compendium Curator para los usuarios con permiso para modificar los ajustes del mundo.

### Modo Curador

Pulsa **Curador** para mostrar las casillas de selección de las entradas.

Una vez seleccionadas, utiliza:

* **Ocultar** para retirarlas del navegador.
* **Mostrar** para restaurarlas.

La casilla situada en la cabecera de la columna permite seleccionar o deseleccionar todas las entradas que cumplen los filtros actuales del navegador, cargando automáticamente los resultados adicionales cuando sea necesario.

### Entradas ocultas

Usa **Ocultos** dentro de los filtros normales del Navegador de Compendios. Emplea el mismo control de tres estados de D&D5e: verde muestra solo entradas ocultas, neutro muestra ambas y rojo excluye las ocultas. Las entradas ocultas siguen apareciendo atenuadas cuando son visibles.

### Duplicados

Pulsa **Duplicados** para mostrar únicamente las entradas cuyo nombre original coincide con otra entrada dentro de los resultados actuales del Navegador de Compendios.

El análisis solo se ejecuta cuando lo solicitas. Mientras trabaja, el botón se convierte en **Cancelar** y el resto del navegador queda bloqueado temporalmente. Cambiar de pestaña, búsqueda, tipo o filtro desactiva el modo Duplicados en vez de volver a calcularlo automáticamente.

El filtro respeta la categoría, búsqueda, fuentes y demás filtros activos del navegador.

Las copias duplicadas se agrupan para facilitar su comparación. Cuando existen traducciones, estas aparecen primero dentro del grupo.

El filtro de tres estados **Ocultos** también decide qué entradas ocultas participan en la detección de duplicados.

#### Prioridad de fuentes

Pulsa **Prioridad** para ordenar las fuentes desde la que prefieres conservar hasta la de menor prioridad.

La prioridad se guarda para todo el mundo y es independiente de la categoría o filtros actuales del navegador.

Pulsa **Aplicar prioridad** para seleccionar automáticamente todas las copias duplicadas excepto la perteneciente a la fuente de mayor prioridad.

La acción solo modifica la selección. Las entradas no se ocultan hasta que pulses **Ocultar**, por lo que puedes revisar y modificar manualmente la selección antes de aplicar los cambios.

#### Traducciones diferentes

Pulsa **Traducciones** para mostrar únicamente los grupos duplicados que contienen dos o más traducciones diferentes para el mismo nombre original.

Las copias sin traducir pueden aparecer dentro de estos grupos para facilitar la comparación, pero una traducción y una copia original sin traducir no se consideran por sí solas un conflicto.

### Gestor de tablas

Pulsa **Gestionar tablas** en el Navegador de Compendios para abrir el Gestor. Una tabla nueva solo pide un nombre; después puedes añadirle categorías reutilizables y tablas enlazadas desde su menú de acciones.

El bloque **Contenido** reúne cada categoría y tabla enlazada como una rama desplegable. Las categorías permiten configurar su agrupación, pesos y reglas. Las tablas enlazadas muestran la estructura original en modo de solo lectura y únicamente permiten cambiar el peso de la relación desde la tabla padre.

La pestaña **Categorías** usa el mismo diseño compacto y desplegable. Cada Categoría contiene uno o más **Grupos de filtros**: los criterios dentro de un grupo se combinan con AND y los grupos hermanos se combinan con OR. La Categoría deduplica por UUID la unión resultante y las tablas reutilizan esa Categoría completa como fuente de inclusión.

El botón `+` de **Grupos de filtros** abre un editor sincronizado con el Navegador de Compendios. Los cambios de filtros, búsqueda, pestaña o modo actualizan en vivo los criterios representados, el contador y la lista previa. Al guardar se conservan los criterios; la lista de coincidencias solo actúa como caché de vista previa y se vuelve a calcular desde esos criterios. Se admiten grupos con cero coincidencias.

La migración de almacenamiento v6 a v7 conserva cada identificador y relación existente. Cada antigua Categoría plana se convierte en una Categoría con un único grupo del mismo nombre y con sus criterios, coincidencias e inclusiones intactos. No se mezclan Categorías ni se inventan agrupaciones entre ellas. Las copias completas y los paquetes de tabla antiguos siguen siendo importables; las nuevas exportaciones usan la jerarquía explícita.

Cada tabla de contenido también puede guardar **Filtros globales** desde el Navegador de Compendios. Funcionan como restricciones de las fuentes locales de la tabla: se cruzan con sus categorías antes de calcular pesos o generar RollTables. Una tabla enlazada continúa tratándose como una referencia opaca y conserva su propia configuración.

Las carpetas del Gestor son una organización visual. La primera vez que se genera una tabla, esa estructura se replica en el mundo o compendio predeterminado. Las actualizaciones posteriores conservan el documento en su ubicación actual; si el usuario lo mueve manualmente a otro lugar, el Gestor no lo devuelve a la fuerza. Las subtablas técnicas se guardan bajo la carpeta raíz **Subtablas**, reflejando la organización del Gestor.

El menú de configuración permite exportar o restaurar una copia completa con perfiles, categorías, carpetas y valores predeterminados. La exportación de una sola tabla conserva sus dependencias, pero se importa en la raíz y no arrastra su carpeta visual de origen. Los valores predeterminados se editan desde **Ajustes de la partida → Configurar ajustes → Compendium Curator**.

### Perfiles

Cada perfil mantiene su propia lista de entradas ocultas.

El selector de perfiles permite cambiar el perfil que está editando el GM.

El menú de configuración situado junto al selector permite:

* Crear un perfil.
* Renombrar un perfil.
* Duplicar un perfil.
* Exportar un perfil a un archivo.
* Importar un perfil desde un archivo.
* Marcar el perfil activo como público.
* Eliminar un perfil.

El perfil público aparece identificado en el selector mediante la etiqueta **Público**.

### Perfil público

Los jugadores siempre utilizan el perfil marcado como público.

El GM puede cambiar a otro perfil para preparar contenido, hacer pruebas o configurar una campaña diferente sin modificar lo que ven los jugadores.

Cuando se marca otro perfil como público, los navegadores abiertos de los jugadores se actualizan automáticamente.

El perfil público no puede eliminarse hasta que se marque otro perfil como público.

## Permisos

Los usuarios con permiso para modificar los ajustes del mundo pueden:

* Activar el modo Curador.
* Mostrar entradas ocultas.
* Ocultar y restaurar entradas.
* Crear, cambiar y eliminar perfiles.
* Elegir el perfil público.

Los demás jugadores no ven los controles del módulo y utilizan siempre las reglas del perfil público.

## Almacenamiento

La configuración se guarda como un ajuste del mundo de Foundry.

Cada mundo mantiene de forma independiente:

* Sus perfiles.
* El perfil activo del GM.
* El perfil público.
* Las entradas ocultas de cada perfil.

## Compatibilidad

Compendium Curator modifica la interfaz del Navegador de Compendios de D&D5e.

Los cambios futuros en la estructura interna de dicho navegador podrían requerir una actualización del módulo.

## Versión

**0.3.0**

## Autor

**Argulf**

## Apoya el proyecto

Compendium Curator es gratuito y de código abierto.

Si el módulo te resulta útil y quieres apoyar su desarrollo y mantenimiento, puedes invitarme a un café:

[Apoyar el proyecto](https://ko-fi.com/argulf)
