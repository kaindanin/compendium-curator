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
* Mostrar temporalmente las entradas ocultas.
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
* Mostrar únicamente las entradas duplicadas dentro de los resultados actuales del navegador.
* Mostrar indicadores de carga durante operaciones largas.

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

Pulsa **Ocultos** para mostrar temporalmente las entradas que están ocultas.

Estas entradas aparecerán atenuadas. Al desactivar la opción volverán a desaparecer del navegador.

### Duplicados

Activa **Solo duplicados** para mostrar únicamente las entradas cuyo nombre original coincide con otra entrada dentro de los resultados actuales del Navegador de Compendios.

El filtro respeta la categoría, búsqueda, fuentes y demás filtros activos del navegador.

Si **Ocultos** está desactivado, las entradas ocultas no participan en la detección de duplicados. Al activarlo, también se tienen en cuenta y aparecen atenuadas como de costumbre.

### Perfiles

Cada perfil mantiene su propia lista de entradas ocultas.

El selector de perfiles permite cambiar el perfil que está editando el GM.

Los botones situados junto al selector permiten:

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

**0.2.0**

## Autor

**Argulf**

## Apoya el proyecto

Compendium Curator es gratuito y de código abierto.

Si el módulo te resulta útil y quieres apoyar su desarrollo y mantenimiento, puedes invitarme a un café:

[Apoyar el proyecto](https://ko-fi.com/argulf)