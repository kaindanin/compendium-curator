# Compendium Curator

**Compendium Curator** es un módulo para Foundry Virtual Tabletop que permite ocultar entradas individuales del Navegador de Compendios de D&D5e.

Está pensado para evitar duplicados, retirar contenido que no se utiliza en una campaña y controlar qué objetos, conjuros, rasgos y demás entradas pueden encontrar los jugadores.

El módulo no elimina ni modifica los documentos originales de los compendios. Solo controla su visibilidad dentro del Navegador de Compendios.

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

La casilla situada en la cabecera de la columna permite seleccionar o deseleccionar todas las entradas visibles.

### Entradas ocultas

Pulsa **Ocultos** para mostrar temporalmente las entradas que están ocultas.

Estas entradas aparecerán atenuadas. Al desactivar la opción volverán a desaparecer del navegador.

### Perfiles

Cada perfil mantiene su propia lista de entradas ocultas.

El selector de perfiles permite cambiar el perfil que está editando el GM.

Los botones situados junto al selector permiten:

* Crear un perfil.
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

**0.1.0**

## Autor

**Argulf**
