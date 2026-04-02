from PIL import Image, ImageDraw

# Load original
img = Image.open("/usr/local/google/home/anathea/.gemini/jetski/brain/91ca4d48-dc23-4494-8b25-f2dcd55ebe62/lemur_app_icon_2_1775088426650.png").convert("RGBA")
w, h = img.size

# Erase the outer 40 pixels dynamically by imposing a circular alpha mask
# This instantly destroys the corner app-icon highlights that were blocking the crop algorithm
mask = Image.new("L", (w, h), 0)
draw = ImageDraw.Draw(mask)
draw.ellipse((40, 40, w-40, h-40), fill=255)

img.putalpha(mask)
img.save("assets/temp.png")
